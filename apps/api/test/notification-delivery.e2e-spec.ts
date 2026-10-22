import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import {
  notificationListSchema,
  notificationNewEventSchema,
  REALTIME_EVENTS,
} from '@ecommerce/types';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../src/shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../src/shared/mail/mail-provider.interface';
import {
  REALTIME_EMITTER,
  type RealtimeEmitter,
} from '../src/shared/realtime/realtime-emitter';
import { RealtimeIoAdapter } from '../src/shared/realtime/realtime-io.adapter';
import {
  addCartItem,
  cleanupByTag,
  createAddress,
  createShopWithProduct,
  createVariant,
} from '../src/shared/testing/db-fixtures';
import { createFakeMail } from '../src/shared/testing/fake-mail';

// e2e THẬT cho việc GIAO thông báo (Week10.md 7.7): app Nest thật nghe trên cổng ngẫu nhiên + Postgres thật, thực hiện
// hành động nghiệp vụ bằng HTTP thật (cookie access_token) và nhận bằng `socket.io-client` thật. Chứng minh điều test
// từng mảnh không chứng minh được: `notification:new` tới ĐÚNG người (mọi tab của họ), mang đúng hàng đã lưu, trong
// dưới 1 giây; người thứ ba (người mua, người ngoài, chủ shop khác, Admin) không nhận gì; người nhận đang ngoại tuyến
// vẫn thấy thông báo trong hộp thư khi quay lại.
//
// KHẲNG ĐỊNH "KHÔNG NHẬN" một cách tất định, không `sleep`: server đẩy sự kiện TRƯỚC khi trả response của lệnh REST,
// và các gói trên MỘT kết nối đến đúng thứ tự server ghi. Nên sau lệnh REST, ta đẩy một sentinel (`chat:read`, sự
// kiện không liên quan tới thông báo) tới đúng người đó rồi chờ nó tới: nếu sentinel đã tới mà chưa thấy
// `notification:new` thì gói đó không bao giờ tới (nó đã phải đến trước sentinel).
//
// Cách chạy: `pnpm test:e2e` (cần Postgres đang chạy). Dữ liệu mang tiền tố TAG, dọn ở beforeAll/afterAll — kể cả thông
// báo gửi tới Admin THẬT của DB dev (chỉ những hàng sinh ra từ lúc spec bắt đầu).
const TAG = 'e2e-notif-delivery-';
const SECRET = 'e2e-notif-delivery-access-secret';
const APP_ORIGIN = 'https://app.e2e-notif-delivery.test';
const NEW = REALTIME_EVENTS.notificationNew;
const SENTINEL = REALTIME_EVENTS.chatRead;

jest.setTimeout(20_000);

describe('Giao thông báo (e2e thật: REST + Postgres + socket.io-client)', () => {
  const prisma = new PrismaClient();
  const jwt = new JwtService();
  const fakeMail = createFakeMail();
  const startedAt = new Date(Date.now() - 1000);
  const savedEnv = {
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    TRUST_PROXY: process.env.TRUST_PROXY,
  };
  let app: INestApplication<Server>;
  let emitter: RealtimeEmitter;
  let url: string;
  let counter = 0;
  const sockets: Socket[] = [];

  // --- dữ liệu -----------------------------------------------------------------------------------------
  const makeUser = (role: Role = Role.USER) =>
    prisma.user.create({
      data: {
        email: `${TAG}${Date.now().toString(36)}-${counter++}@test.local`,
        name: `${TAG}user`,
        role,
        emailVerifiedAt: new Date(),
      },
      select: { id: true, role: true },
    });
  type TestUser = Awaited<ReturnType<typeof makeUser>>;

  const cookieOf = async (user: TestUser) =>
    `access_token=${await jwt.signAsync(
      {
        sub: user.id,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + 15 * 60,
      },
      { secret: SECRET, algorithm: 'HS256' },
    )}`;

  // --- REST --------------------------------------------------------------------------------------------
  const rest = async (
    user: TestUser,
    method: 'get' | 'post',
    path: string,
    body?: object,
  ) => {
    const req = request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Cookie', await cookieOf(user));
    return body ? req.send(body) : req;
  };
  const dataOf = (res: { body: unknown }) =>
    (res.body as { data: unknown }).data;
  const inboxOf = async (user: TestUser) => {
    const res = await rest(user, 'get', '/notifications?limit=50');
    expect(res.status).toBe(200);
    return notificationListSchema.parse(dataOf(res)).items;
  };

  // --- socket ------------------------------------------------------------------------------------------
  const open = async (user: TestUser): Promise<Socket> => {
    const socket = io(url, {
      transports: ['websocket'],
      extraHeaders: { Origin: APP_ORIGIN, Cookie: await cookieOf(user) },
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (error) => reject(error));
    });
    return socket;
  };

  // Ghi lại mọi sự kiện [tên, payload] mà socket nhận, theo thứ tự (trừ sentinel).
  const record = (socket: Socket) => {
    const events: [string, unknown][] = [];
    const waiters: (() => void)[] = [];
    socket.onAny((event: string, payload: unknown) => {
      if (event === SENTINEL) return;
      events.push([event, payload]);
      waiters.splice(0).forEach((wake) => wake());
    });
    return {
      events,
      untilCount: async (count: number) => {
        while (events.length < count) {
          await new Promise<void>((resolve) => waiters.push(resolve));
        }
      },
    };
  };

  // Chờ tới khi sentinel (gửi tới `user`) về tới `socket`: lúc đó mọi gói gửi trước đó cho socket này đã tới.
  async function settle(socket: Socket, user: TestUser) {
    const arrived = new Promise<void>((resolve) => {
      socket.once(SENTINEL, () => resolve());
    });
    await emitter.emitToUser(user.id, SENTINEL, {
      conversationId: randomUUID(),
      readAt: new Date().toISOString(),
    });
    await arrived;
  }

  // --- bối cảnh ----------------------------------------------------------------------------------------
  let buyer: TestUser;
  let sellerA: TestUser;
  let sellerB: TestUser;
  let stranger: TestUser;
  let admin: TestUser;
  let shopA: string;
  let shopB: string;
  let variantA: string;
  let variantB: string;
  let addressId: string;

  // Mở tab cho mọi nhân vật: hai tab người mua, hai tab chủ shop A, một tab cho từng người còn lại.
  async function openAll() {
    const [buyerTab1, buyerTab2, sellerATab1, sellerATab2] = [
      await open(buyer),
      await open(buyer),
      await open(sellerA),
      await open(sellerA),
    ];
    const [sellerBSock, strangerSock, adminSock] = [
      await open(sellerB),
      await open(stranger),
      await open(admin),
    ];
    return {
      sock: {
        buyerTab1,
        buyerTab2,
        sellerATab1,
        sellerATab2,
        sellerBSock,
        strangerSock,
        adminSock,
      },
      got: {
        buyerTab1: record(buyerTab1),
        buyerTab2: record(buyerTab2),
        sellerATab1: record(sellerATab1),
        sellerATab2: record(sellerATab2),
        sellerB: record(sellerBSock),
        stranger: record(strangerSock),
        admin: record(adminSock),
      },
    };
  }
  type Everyone = Awaited<ReturnType<typeof openAll>>;

  // Đặt COD hai shop bằng checkout thật; trả id đơn theo shop.
  async function placeCodOrders() {
    await addCartItem(prisma, buyer.id, variantA, 1);
    await addCartItem(prisma, buyer.id, variantB, 1);
    const preview = await rest(buyer, 'post', '/checkout/preview', {
      addressId,
    });
    const res = await rest(buyer, 'post', '/checkout', {
      addressId,
      paymentMethod: 'COD',
      expectedTotal: Number(
        (dataOf(preview) as { grandTotal: string }).grandTotal,
      ),
    });
    expect(res.status).toBe(201);
    const { checkoutGroupId } = dataOf(res) as { checkoutGroupId: string };
    const orders = await prisma.order.findMany({
      where: { checkoutGroupId },
      select: { id: true, shopId: true },
    });
    const orderOf = (shopId: string) =>
      orders.find((order) => order.shopId === shopId)!.id;
    return { orderA: orderOf(shopA), orderB: orderOf(shopB) };
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = SECRET;
    process.env.CORS_ORIGIN = APP_ORIGIN;
    delete process.env.TRUST_PROXY;
    await cleanupByTag(prisma, TAG);

    const a = await createShopWithProduct(prisma, TAG);
    const b = await createShopWithProduct(prisma, TAG);
    shopA = a.shopId;
    shopB = b.shopId;
    variantA = (await createVariant(prisma, a, { stock: 500 })).id;
    variantB = (await createVariant(prisma, b, { stock: 500 })).id;
    sellerA = { id: a.ownerId, role: Role.USER };
    sellerB = { id: b.ownerId, role: Role.USER };
    [buyer, stranger, admin] = [
      await makeUser(),
      await makeUser(),
      await makeUser(Role.ADMIN),
    ];
    addressId = (await createAddress(prisma, buyer.id)).id;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(fakeMail.provider)
      .compile();
    app = moduleFixture.createNestApplication();
    // Giống main.ts: prefix REST, cookie-parser, interceptor/filter, adapter Socket.io tuỳ biến.
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useWebSocketAdapter(new RealtimeIoAdapter(app));
    await app.listen(0);
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    emitter = app.get<RealtimeEmitter>(REALTIME_EMITTER);
  });

  beforeEach(async () => {
    await prisma.notification.deleteMany({
      where: {
        OR: [
          { user: { email: { startsWith: TAG } } },
          { createdAt: { gte: startedAt }, user: { role: 'ADMIN' } },
        ],
      },
    });
    await prisma.cartItem.deleteMany({ where: { cart: { userId: buyer.id } } });
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  afterAll(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await app.close();
    await prisma.notification.deleteMany({
      where: { createdAt: { gte: startedAt }, user: { role: 'ADMIN' } },
    });
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  // Khẳng định các nhân vật được liệt kê không nhận GÌ (chờ sentinel của chính từng người).
  async function expectGotNothing(
    all: Everyone,
    who: ('buyer' | 'sellerA' | 'sellerB' | 'stranger' | 'admin')[],
  ) {
    const pairs = {
      buyer: [all.sock.buyerTab1, buyer, all.got.buyerTab1],
      sellerA: [all.sock.sellerATab1, sellerA, all.got.sellerATab1],
      sellerB: [all.sock.sellerBSock, sellerB, all.got.sellerB],
      stranger: [all.sock.strangerSock, stranger, all.got.stranger],
      admin: [all.sock.adminSock, admin, all.got.admin],
    } as const;
    await Promise.all(
      who.map((name) => settle(pairs[name][0], pairs[name][1])),
    );
    for (const name of who) expect(pairs[name][2].events).toEqual([]);
  }

  // -------------------------------------------------------------------------------------------------------
  it('đặt COD hai shop ⇒ MỌI tab của từng chủ shop nhận ĐÚNG một notification:new cho đơn của mình trong < 1 giây; người mua, người ngoài, Admin không nhận gì', async () => {
    const all = await openAll();

    const startedAtMs = performance.now();
    const { orderA, orderB } = await placeCodOrders();
    await Promise.all([
      all.got.sellerATab1.untilCount(1),
      all.got.sellerATab2.untilCount(1),
      all.got.sellerB.untilCount(1),
    ]);
    const elapsed = performance.now() - startedAtMs;

    expect(elapsed).toBeLessThan(1_000);
    for (const tab of [all.got.sellerATab1, all.got.sellerATab2]) {
      expect(tab.events).toHaveLength(1);
      const [event, payload] = tab.events[0];
      expect(event).toBe(NEW);
      const parsed = notificationNewEventSchema.parse(payload);
      expect(parsed).toMatchObject({
        type: 'ORDER_NEW',
        data: { orderId: orderA },
        readAt: null,
      });
    }
    const [, payloadB] = all.got.sellerB.events[0];
    expect(notificationNewEventSchema.parse(payloadB)).toMatchObject({
      type: 'ORDER_NEW',
      data: { orderId: orderB },
    });
    await expectGotNothing(all, ['buyer', 'stranger', 'admin']);
    expect(all.got.buyerTab2.events).toEqual([]);
    // Hai tab của cùng một người nhận cùng MỘT thông báo.
    expect(all.got.sellerATab1.events[0][1]).toEqual(
      all.got.sellerATab2.events[0][1],
    );
  });

  it('gói đẩy là CHÍNH hàng đã lưu: cùng id, cùng nội dung với hộp thư đọc qua REST', async () => {
    const all = await openAll();

    await placeCodOrders();
    await all.got.sellerATab1.untilCount(1);

    const pushed = notificationNewEventSchema.parse(
      all.got.sellerATab1.events[0][1],
    );
    const stored = await inboxOf(sellerA);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(pushed);
    // Chưa đọc cho tới khi người dùng thật sự đọc.
    const count = await rest(sellerA, 'get', '/notifications/unread-count');
    expect(dataOf(count)).toEqual({ unreadCount: 1 });
  });

  it('chủ shop xác nhận ⇒ MỌI tab của NGƯỜI MUA nhận ORDER_CONFIRMED; chủ shop, shop khác, người ngoài không nhận gì thêm', async () => {
    const { orderA } = await placeCodOrders();
    const all = await openAll();

    const res = await rest(
      sellerA,
      'post',
      `/shops/${shopA}/orders/${orderA}/confirm`,
    );
    await Promise.all([
      all.got.buyerTab1.untilCount(1),
      all.got.buyerTab2.untilCount(1),
    ]);

    expect(res.status).toBe(200);
    for (const tab of [all.got.buyerTab1, all.got.buyerTab2]) {
      expect(tab.events).toHaveLength(1);
      expect(tab.events[0][0]).toBe(NEW);
      expect(notificationNewEventSchema.parse(tab.events[0][1])).toMatchObject({
        type: 'ORDER_CONFIRMED',
        data: { orderId: orderA },
      });
    }
    await expectGotNothing(all, ['sellerA', 'sellerB', 'stranger', 'admin']);
  });

  it('chủ shop nộp lại sau khi bị từ chối ⇒ Admin đang kết nối nhận ADMIN_SHOP_PENDING; người mua, chủ shop khác, người ngoài không nhận gì', async () => {
    const owner = await makeUser();
    const shop = await prisma.shop.create({
      data: {
        ownerId: owner.id,
        name: `${TAG}shop-resubmit`,
        slug: `${TAG}shop-resubmit-${Date.now().toString(36)}`,
        status: 'REJECTED',
      },
      select: { id: true },
    });
    const all = await openAll();

    const res = await rest(owner, 'post', `/shops/${shop.id}/resubmit`, {});
    await all.got.admin.untilCount(1);

    expect(res.status).toBe(200);
    expect(all.got.admin.events).toHaveLength(1);
    expect(all.got.admin.events[0][0]).toBe(NEW);
    expect(
      notificationNewEventSchema.parse(all.got.admin.events[0][1]),
    ).toMatchObject({
      type: 'ADMIN_SHOP_PENDING',
      data: { shopId: shop.id },
    });
    await expectGotNothing(all, ['buyer', 'sellerA', 'sellerB', 'stranger']);
  });

  it('người nhận đang NGOẠI TUYẾN không mất thông báo: đã lưu sẵn trong hộp thư, mở kết nối sau đó không phát lại gói cũ', async () => {
    const { orderA } = await placeCodOrders();

    const sellerTab = await open(sellerA);
    const got = record(sellerTab);
    await settle(sellerTab, sellerA);

    expect(got.events).toEqual([]);
    const stored = await inboxOf(sellerA);
    expect(stored.map((item) => item.type)).toEqual(['ORDER_NEW']);
    expect(stored[0].data).toMatchObject({ orderId: orderA });
  });
});
