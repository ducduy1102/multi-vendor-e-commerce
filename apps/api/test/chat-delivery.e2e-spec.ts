import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, Role, ShopStatus } from '@prisma/client';
import {
  chatMessageEventSchema,
  chatReadPayloadSchema,
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
import { cleanupByTag } from '../src/shared/testing/db-fixtures';
import { createFakeMail } from '../src/shared/testing/fake-mail';

// e2e THẬT cho việc GIAO tin (Week10.md 4.8): app Nest thật nghe trên cổng ngẫu nhiên + Postgres thật, gửi tin bằng
// HTTP thật (cookie access_token) và nhận bằng `socket.io-client` thật. Chứng minh điều test từng mảnh không chứng
// minh được: tin gửi qua REST tới đúng người, đúng vai, trong dưới 1 giây; người thứ ba (người ngoài, người mua
// khác của cùng shop, chủ shop khác) không nhận gì; client không có cách nào tự vào phòng của người khác.
//
// KHẲNG ĐỊNH "KHÔNG NHẬN" một cách tất định, không `sleep`: server đẩy sự kiện TRƯỚC khi trả response của lệnh REST,
// và các gói trên MỘT kết nối đến đúng thứ tự server ghi. Nên sau lệnh REST, ta đẩy một sentinel tới đúng người
// đó (qua cổng emitter) rồi chờ nó tới: nếu sentinel đã tới mà chưa thấy gói chat nào thì gói chat đó không bao giờ
// tới (nó đã phải đến trước sentinel).
//
// Cách chạy: `pnpm test:e2e` (cần Postgres đang chạy). Dữ liệu mang tiền tố TAG, dọn ở beforeAll/afterAll.
const TAG = 'e2e-chat-delivery-';
const SECRET = 'e2e-chat-delivery-access-secret';
const APP_ORIGIN = 'https://app.e2e-chat-delivery.test';
const MESSAGE = REALTIME_EVENTS.chatMessage;
const READ = REALTIME_EVENTS.chatRead;
const SENTINEL = REALTIME_EVENTS.notificationNew;

jest.setTimeout(15_000);

describe('Giao tin chat (e2e thật: REST + Postgres + socket.io-client)', () => {
  const prisma = new PrismaClient();
  const jwt = new JwtService();
  const fakeMail = createFakeMail();
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
  const makeUser = () =>
    prisma.user.create({
      data: {
        email: `${TAG}${Date.now().toString(36)}-${counter++}@test.local`,
        name: `${TAG}user`,
        role: Role.USER,
        emailVerifiedAt: new Date(),
      },
      select: { id: true, role: true },
    });
  type TestUser = Awaited<ReturnType<typeof makeUser>>;

  const makeShop = async (
    ownerId: string,
    status: ShopStatus = ShopStatus.APPROVED,
  ) =>
    (
      await prisma.shop.create({
        data: {
          ownerId,
          name: `${TAG}shop`,
          slug: `${TAG}shop-${Date.now().toString(36)}-${counter++}`,
          status,
        },
        select: { id: true },
      })
    ).id;

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
  // Gọi API thật bằng cookie access_token (cùng đường mà trình duyệt đi).
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

  // Chờ tới khi sentinel (gửi tới `user`) về tới `socket`: lúc đó mọi gói chat gửi trước đó cho socket này đã tới.
  async function settle(socket: Socket, user: TestUser) {
    const arrived = new Promise<void>((resolve) => {
      socket.once(SENTINEL, () => resolve());
    });
    await emitter.emitToUser(user.id, SENTINEL, {});
    await arrived;
  }

  // --- bối cảnh ----------------------------------------------------------------------------------------
  let buyer: TestUser;
  let buyer2: TestUser; // người mua KHÁC của cùng shop
  let seller: TestUser;
  let stranger: TestUser; // người dùng bình thường, không liên quan
  let otherSeller: TestUser; // chủ một shop khác
  let shopId: string;
  let conversationId: string;

  const sendBody = (content: string, clientMessageId = randomUUID()) => ({
    content,
    clientMessageId,
  });

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = SECRET;
    process.env.CORS_ORIGIN = APP_ORIGIN;
    delete process.env.TRUST_PROXY;
    await cleanupByTag(prisma, TAG);

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

    [buyer, buyer2, seller, stranger, otherSeller] = [
      await makeUser(),
      await makeUser(),
      await makeUser(),
      await makeUser(),
      await makeUser(),
    ];
    shopId = await makeShop(seller.id);
    await makeShop(otherSeller.id);
    const open = await rest(buyer, 'post', '/conversations', { shopId });
    conversationId = (dataOf(open) as { id: string }).id;
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  afterAll(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await app.close();
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  // Mở đủ các socket quan sát: hai tab người mua, hai tab chủ shop, và ba "người thứ ba".
  async function openAll() {
    const [buyerTab1, buyerTab2, sellerTab1, sellerTab2] = [
      await open(buyer),
      await open(buyer),
      await open(seller),
      await open(seller),
    ];
    const [strangerSock, buyer2Sock, otherSellerSock] = [
      await open(stranger),
      await open(buyer2),
      await open(otherSeller),
    ];
    return {
      buyerTab1,
      buyerTab2,
      sellerTab1,
      sellerTab2,
      strangerSock,
      buyer2Sock,
      otherSellerSock,
      got: {
        buyerTab1: record(buyerTab1),
        buyerTab2: record(buyerTab2),
        sellerTab1: record(sellerTab1),
        sellerTab2: record(sellerTab2),
        stranger: record(strangerSock),
        buyer2: record(buyer2Sock),
        otherSeller: record(otherSellerSock),
      },
    };
  }

  // Khẳng định ba "người thứ ba" không nhận GÌ (chờ sentinel của chính từng người).
  async function expectOutsidersGotNothing(
    all: Awaited<ReturnType<typeof openAll>>,
  ) {
    await Promise.all([
      settle(all.strangerSock, stranger),
      settle(all.buyer2Sock, buyer2),
      settle(all.otherSellerSock, otherSeller),
    ]);
    expect(all.got.stranger.events).toEqual([]);
    expect(all.got.buyer2.events).toEqual([]);
    expect(all.got.otherSeller.events).toEqual([]);
  }

  // -------------------------------------------------------------------------------------------------------
  describe('gửi qua REST ⇒ đẩy qua socket', () => {
    it('người mua gửi ⇒ MỌI tab của chủ shop nhận chat:message trong < 1 giây, đúng vai SHOP, không có clientMessageId', async () => {
      const all = await openAll();
      const clientMessageId = randomUUID();

      const startedAt = performance.now();
      const res = await rest(
        buyer,
        'post',
        `/conversations/${conversationId}/messages`,
        sendBody('Shop còn size M không ạ?', clientMessageId),
      );
      await Promise.all([
        all.got.sellerTab1.untilCount(1),
        all.got.sellerTab2.untilCount(1),
      ]);
      const elapsed = performance.now() - startedAt;

      expect(res.status).toBe(201);
      expect(elapsed).toBeLessThan(1_000);
      for (const tab of [all.got.sellerTab1, all.got.sellerTab2]) {
        const [[event, payload]] = tab.events;
        expect(event).toBe(MESSAGE);
        const parsed = chatMessageEventSchema.strict().parse(payload);
        expect(parsed).toMatchObject({
          viewerRole: 'SHOP',
          shopId,
          message: {
            conversationId,
            senderRole: 'BUYER',
            content: 'Shop còn size M không ạ?',
          },
        });
        expect(parsed.message.clientMessageId).toBeUndefined();
      }
    });

    it('chính người gửi cũng được đẩy (để đồng bộ tab khác) với vai BUYER và clientMessageId để đối chiếu tin tạm', async () => {
      const all = await openAll();
      const clientMessageId = randomUUID();

      await rest(
        buyer,
        'post',
        `/conversations/${conversationId}/messages`,
        sendBody('tin cho tab khác', clientMessageId),
      );
      await Promise.all([
        all.got.buyerTab1.untilCount(1),
        all.got.buyerTab2.untilCount(1),
        all.got.sellerTab1.untilCount(1),
      ]);

      for (const tab of [all.got.buyerTab1, all.got.buyerTab2]) {
        const parsed = chatMessageEventSchema.parse(tab.events[0][1]);
        expect(parsed.viewerRole).toBe('BUYER');
        expect(parsed.message.clientMessageId).toBe(clientMessageId);
      }
    });

    it('người thứ ba (người ngoài, người mua khác của CÙNG shop, chủ shop khác) không nhận GÌ', async () => {
      const all = await openAll();

      await rest(
        buyer,
        'post',
        `/conversations/${conversationId}/messages`,
        sendBody('riêng tư'),
      );
      await all.got.sellerTab1.untilCount(1);

      await expectOutsidersGotNothing(all);
    });

    it('chủ shop trả lời qua đường dẫn shop ⇒ MỌI tab người mua nhận với vai BUYER, tab khác của chủ shop nhận với vai SHOP', async () => {
      const all = await openAll();

      const res = await rest(
        seller,
        'post',
        `/shops/${shopId}/conversations/${conversationId}/messages`,
        sendBody('Còn nhé bạn'),
      );
      await Promise.all([
        all.got.buyerTab1.untilCount(1),
        all.got.buyerTab2.untilCount(1),
        all.got.sellerTab1.untilCount(1),
        all.got.sellerTab2.untilCount(1),
      ]);

      expect(res.status).toBe(201);
      const roleOf = (tab: { events: [string, unknown][] }) =>
        chatMessageEventSchema.parse(tab.events[0][1]).viewerRole;
      expect(roleOf(all.got.buyerTab1)).toBe('BUYER');
      expect(roleOf(all.got.buyerTab2)).toBe('BUYER');
      expect(roleOf(all.got.sellerTab1)).toBe('SHOP');
      expect(roleOf(all.got.sellerTab2)).toBe('SHOP');
      await expectOutsidersGotNothing(all);
    });

    it('gửi lại đúng tin đã nhận (cùng clientMessageId) ⇒ 200 và KHÔNG đẩy lại lần nữa', async () => {
      const all = await openAll();
      const body = sendBody('chỉ một lần', randomUUID());
      const path = `/conversations/${conversationId}/messages`;
      await rest(buyer, 'post', path, body);
      await all.got.sellerTab1.untilCount(1);

      const replay = await rest(buyer, 'post', path, body);
      await Promise.all([
        settle(all.sellerTab1, seller),
        settle(all.buyerTab1, buyer),
      ]);

      expect(replay.status).toBe(200);
      expect(all.got.sellerTab1.events).toHaveLength(1);
      expect(all.got.buyerTab1.events).toHaveLength(1);
    });

    it('lệnh bị từ chối (người ngoài, shop bị khoá, nội dung sai) ⇒ không ai nhận gì', async () => {
      const suspendedOwner = await makeUser();
      const suspendedShop = await makeShop(
        suspendedOwner.id,
        ShopStatus.SUSPENDED,
      );
      const suspendedConversation = (
        await prisma.conversation.create({
          data: { buyerId: buyer.id, shopId: suspendedShop },
          select: { id: true },
        })
      ).id;
      const all = await openAll();
      const suspendedSocket = await open(suspendedOwner);
      const suspendedGot = record(suspendedSocket);

      const byStranger = await rest(
        stranger,
        'post',
        `/conversations/${conversationId}/messages`,
        sendBody('chen vào'),
      );
      const toSuspended = await rest(
        buyer,
        'post',
        `/conversations/${suspendedConversation}/messages`,
        sendBody('shop đã khoá'),
      );
      const invalid = await rest(
        buyer,
        'post',
        `/conversations/${conversationId}/messages`,
        { content: '', clientMessageId: randomUUID() },
      );
      await Promise.all([
        settle(all.sellerTab1, seller),
        settle(all.buyerTab1, buyer),
        settle(suspendedSocket, suspendedOwner),
      ]);

      expect([byStranger.status, toSuspended.status, invalid.status]).toEqual([
        404, 409, 400,
      ]);
      expect(all.got.sellerTab1.events).toEqual([]);
      expect(all.got.buyerTab1.events).toEqual([]);
      expect(suspendedGot.events).toEqual([]);
      await expectOutsidersGotNothing(all);
    });
  });

  // -------------------------------------------------------------------------------------------------------
  describe('đánh dấu đã đọc ⇒ chat:read tới đúng đối phương', () => {
    it('chủ shop đọc ⇒ MỌI tab người mua nhận { conversationId, readAt }; tab của chính chủ shop và người ngoài không nhận', async () => {
      const all = await openAll();
      await rest(
        buyer,
        'post',
        `/conversations/${conversationId}/messages`,
        sendBody('tin để đọc'),
      );
      // Chờ cả hai phía nhận xong chat:message của chính tin này rồi mới đếm mốc, để sau đó chỉ còn chat:read.
      await Promise.all([
        all.got.sellerTab1.untilCount(1),
        all.got.buyerTab1.untilCount(1),
        all.got.buyerTab2.untilCount(1),
      ]);
      const eventsBefore = all.got.buyerTab1.events.length;

      const res = await rest(
        seller,
        'post',
        `/shops/${shopId}/conversations/${conversationId}/read`,
      );
      await Promise.all([
        all.got.buyerTab1.untilCount(eventsBefore + 1),
        all.got.buyerTab2.untilCount(eventsBefore + 1),
      ]);
      await Promise.all([
        settle(all.sellerTab1, seller),
        settle(all.sellerTab2, seller),
      ]);

      expect(res.status).toBe(200);
      for (const tab of [all.got.buyerTab1, all.got.buyerTab2]) {
        const [event, payload] = tab.events[tab.events.length - 1];
        expect(event).toBe(READ);
        expect(chatReadPayloadSchema.strict().parse(payload)).toEqual({
          conversationId,
          readAt: (dataOf(res) as { readAt: string }).readAt,
        });
      }
      // chủ shop chỉ nhận chat:message của tin mình đã thấy, không nhận chat:read của chính mình
      expect(
        all.got.sellerTab1.events.filter(([event]) => event === READ),
      ).toEqual([]);
      expect(
        all.got.sellerTab2.events.filter(([event]) => event === READ),
      ).toEqual([]);
      await expectOutsidersGotNothing(all);
    });

    it('đánh dấu lại khi không có gì mới ⇒ không đẩy thêm chat:read', async () => {
      const all = await openAll();
      const path = `/shops/${shopId}/conversations/${conversationId}/read`;
      await rest(seller, 'post', path); // có thể nhích mốc (nếu còn tin chưa đọc)
      await Promise.all([
        settle(all.buyerTab1, buyer),
        settle(all.buyerTab2, buyer),
      ]);
      const countAfterFirst = all.got.buyerTab1.events.length;

      const again = await rest(seller, 'post', path);
      await Promise.all([
        settle(all.buyerTab1, buyer),
        settle(all.buyerTab2, buyer),
      ]);

      expect(again.status).toBe(200);
      expect(all.got.buyerTab1.events).toHaveLength(countAfterFirst);
    });
  });

  // -------------------------------------------------------------------------------------------------------
  describe('client không có cách nào tự nghe lén phòng của người khác', () => {
    it('người ngoài bịa sự kiện join/subscribe/joinRoom nhắm vào phòng của người mua và chủ shop ⇒ vẫn không nhận tin', async () => {
      const all = await openAll();
      const targets = [buyer, seller].map((user) => `user:${user.id}`);

      for (const room of targets) {
        all.strangerSock.emit('join', { room });
        all.strangerSock.emit('join', room);
        all.strangerSock.emit('joinRoom', room);
        all.strangerSock.emit('subscribe', { conversationId, room });
        all.strangerSock.emit('chat:join', { conversationId });
      }
      await settle(all.strangerSock, stranger);
      await rest(
        buyer,
        'post',
        `/conversations/${conversationId}/messages`,
        sendBody('người ngoài không nghe được'),
      );
      await rest(
        seller,
        'post',
        `/shops/${shopId}/conversations/${conversationId}/messages`,
        sendBody('trả lời'),
      );
      await Promise.all([
        all.got.sellerTab1.untilCount(2),
        all.got.buyerTab1.untilCount(2),
      ]);

      await expectOutsidersGotNothing(all);
      expect(all.strangerSock.connected).toBe(true);
    });
  });
});
