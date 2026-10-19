import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, Role, ShopStatus } from '@prisma/client';
import { REALTIME_EVENTS } from '@ecommerce/types';
import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../src/shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../src/shared/mail/mail-provider.interface';
import { RealtimeIoAdapter } from '../src/shared/realtime/realtime-io.adapter';
import { cleanupByTag } from '../src/shared/testing/db-fixtures';
import { createFakeMail } from '../src/shared/testing/fake-mail';

// e2e THẬT cho "đang gõ" (Week10.md 4.7): app Nest thật nghe trên cổng ngẫu nhiên + Postgres thật +
// `socket.io-client` thật. Chứng minh điều unit test không chứng minh được: ChatGateway thực sự được nối vào CÙNG
// server Socket.io với RealtimeGateway (đi qua middleware xác thực của nó), người nhận đúng là đối phương, người
// ngoài không nhận gì, và tuỳ chọn bảo mật (gói nhỏ) vẫn có hiệu lực khi có hai gateway.
//
// QUY TẮC CHỐNG CHẬP CHỜN (như test/realtime.e2e-spec.ts): không `sleep`. Chờ MỘT SỰ KIỆN, listener luôn đăng ký
// TRƯỚC hành động gây ra nó. Khẳng định "KHÔNG nhận" bằng một TÍN HIỆU CANH dương tính phát từ CHÍNH socket đã gửi
// sự kiện cần kiểm: người gõ gửi thêm tín hiệu cho một hội thoại điều khiển (mình là thành viên) rồi chờ bên nhận
// điều khiển thấy nó. Hai tín hiệu canh liên tiếp (hai hội thoại điều khiển) để chắc rằng các sự kiện gửi trước đó
// — mỗi cái cần vài lượt truy vấn DB — đã xử lý xong; đây là bảo đảm thực tế rất mạnh chứ không tuyệt đối, phần tuyệt
// đối nằm ở unit test của gateway (chat.gateway.spec.ts).
//
// Cách chạy: `pnpm test:e2e` (cần Postgres đang chạy). Dữ liệu mang tiền tố TAG, dọn ở beforeAll/afterAll.
const TAG = 'e2e-chat-typing-';
const SECRET = 'e2e-chat-typing-access-secret';
const APP_ORIGIN = 'https://app.e2e-chat-typing.test';
const TYPING = REALTIME_EVENTS.chatTyping;

jest.setTimeout(15_000);

describe('Đang gõ (e2e thật: Nest + Postgres + socket.io-client)', () => {
  const prisma = new PrismaClient();
  const jwt = new JwtService();
  const fakeMail = createFakeMail();
  const savedEnv = {
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    TRUST_PROXY: process.env.TRUST_PROXY,
  };
  let app: INestApplication<Server>;
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

  // Hội thoại (buyer, shop) — `withMessage` đặt lastMessageAt như khi đã có tin (hội thoại chưa có tin không được
  // báo "đang gõ" cho đối phương).
  const makeConversation = async (
    buyerId: string,
    shopId: string,
    withMessage = true,
  ) => {
    const conversation = await prisma.conversation.create({
      data: { buyerId, shopId },
      select: { id: true },
    });
    if (withMessage) {
      const at = new Date(Date.now() - 60_000);
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: buyerId,
          content: 'xin chào',
          createdAt: at,
        },
      });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: at },
      });
    }
    return conversation.id;
  };

  const cookieOf = async (user: TestUser) =>
    `access_token=${await jwt.signAsync(
      {
        sub: user.id,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + 15 * 60,
      },
      { secret: SECRET, algorithm: 'HS256' },
    )}`;

  // --- kết nối và chờ sự kiện --------------------------------------------------------------------------
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

  // Ghi lại mọi payload `chat:typing` socket nhận được, theo thứ tự.
  const listen = (socket: Socket) => {
    const payloads: unknown[] = [];
    const waiters: (() => void)[] = [];
    socket.on(TYPING, (payload: unknown) => {
      payloads.push(payload);
      waiters.splice(0).forEach((wake) => wake());
    });
    return {
      payloads,
      // Chờ tới khi có ít nhất `count` tín hiệu.
      untilCount: async (count: number) => {
        while (payloads.length < count) {
          await new Promise<void>((resolve) => waiters.push(resolve));
        }
      },
    };
  };

  // --- bối cảnh dùng chung -----------------------------------------------------------------------------
  let buyer: TestUser;
  let owner: TestUser;
  let stranger: TestUser;
  let controlOwner: TestUser;
  let conversationId: string;
  let controlListener: ReturnType<typeof listen>;
  let controlSocket: Socket;

  // Hội thoại điều khiển mới cho `member`: (member, shop của controlOwner). Mỗi lần dùng một hội thoại riêng vì
  // mỗi hội thoại chỉ được 1 tín hiệu/2 giây/socket.
  const controlConversationFor = async (member: TestUser) =>
    makeConversation(member.id, await makeShop(controlOwner.id));

  // Khẳng định mọi sự kiện đã gửi trước đó từ `actor` đã được server xử lý xong: phát hai tín hiệu canh dương tính
  // từ chính `actor` và chờ bên nhận điều khiển thấy cả hai.
  async function flush(actor: Socket, member: TestUser) {
    const before = controlListener.payloads.length;
    const first = await controlConversationFor(member);
    const second = await controlConversationFor(member);
    actor.emit(TYPING, { conversationId: first });
    actor.emit(TYPING, { conversationId: second });
    await controlListener.untilCount(before + 2);
  }

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

    [buyer, owner, stranger, controlOwner] = [
      await makeUser(),
      await makeUser(),
      await makeUser(),
      await makeUser(),
    ];
    conversationId = await makeConversation(buyer.id, await makeShop(owner.id));
    controlSocket = await open(controlOwner);
    controlListener = listen(controlSocket);
  });

  afterEach(() => {
    // Giữ lại socket điều khiển (dùng suốt file); đóng các socket khác.
    for (const socket of sockets.splice(0)) {
      if (socket !== controlSocket) socket.close();
      else sockets.push(socket);
    }
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

  // -------------------------------------------------------------------------------------------------------
  describe('chuyển tín hiệu tới đúng đối phương', () => {
    it('người mua gõ ⇒ chủ shop nhận đúng { conversationId }; tab khác của người mua và người ngoài không nhận gì', async () => {
      const [buyerTab1, buyerTab2, ownerSocket, outsider] = [
        await open(buyer),
        await open(buyer),
        await open(owner),
        await open(stranger),
      ];
      const ownerGot = listen(ownerSocket);
      const buyerTab2Got = listen(buyerTab2);
      const outsiderGot = listen(outsider);

      buyerTab1.emit(TYPING, { conversationId });
      await ownerGot.untilCount(1);
      await flush(buyerTab1, buyer);

      expect(ownerGot.payloads).toEqual([{ conversationId }]);
      expect(buyerTab2Got.payloads).toEqual([]);
      expect(outsiderGot.payloads).toEqual([]);
    });

    it('chủ shop gõ ⇒ người mua nhận (mọi tab của họ), chính chủ shop không nhận lại', async () => {
      const [ownerSocket, buyerTab1, buyerTab2] = [
        await open(owner),
        await open(buyer),
        await open(buyer),
      ];
      const ownerGot = listen(ownerSocket);
      const tab1Got = listen(buyerTab1);
      const tab2Got = listen(buyerTab2);

      ownerSocket.emit(TYPING, { conversationId });
      await Promise.all([tab1Got.untilCount(1), tab2Got.untilCount(1)]);
      await flush(ownerSocket, owner);

      expect(tab1Got.payloads).toEqual([{ conversationId }]);
      expect(tab2Got.payloads).toEqual([{ conversationId }]);
      expect(ownerGot.payloads).toEqual([]);
    });

    it('client nhét người nhận vào payload (toUserId, recipientId...) ⇒ bị bỏ; người nhận vẫn chỉ là đối phương thật', async () => {
      const [buyerSocket, ownerSocket, outsider] = [
        await open(buyer),
        await open(owner),
        await open(stranger),
      ];
      const ownerGot = listen(ownerSocket);
      const outsiderGot = listen(outsider);

      buyerSocket.emit(TYPING, {
        conversationId,
        toUserId: stranger.id,
        recipientId: stranger.id,
        userId: stranger.id,
      });
      await ownerGot.untilCount(1);
      await flush(buyerSocket, buyer);

      expect(ownerGot.payloads).toEqual([{ conversationId }]);
      expect(outsiderGot.payloads).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------------------------------------
  describe('không phải thành viên / không đủ điều kiện ⇒ không ai nhận gì', () => {
    it('người ngoài gõ vào hội thoại của người khác ⇒ cả người mua lẫn chủ shop đều không nhận', async () => {
      const [outsider, buyerSocket, ownerSocket] = [
        await open(stranger),
        await open(buyer),
        await open(owner),
      ];
      const buyerGot = listen(buyerSocket);
      const ownerGot = listen(ownerSocket);

      outsider.emit(TYPING, { conversationId });
      await flush(outsider, stranger);

      expect(buyerGot.payloads).toEqual([]);
      expect(ownerGot.payloads).toEqual([]);
    });

    it('hội thoại không tồn tại hoặc payload sai ⇒ bỏ im lặng, socket KHÔNG bị ngắt và gõ hợp lệ sau đó vẫn chạy', async () => {
      const [buyerSocket, ownerSocket] = [await open(buyer), await open(owner)];
      const ownerGot = listen(ownerSocket);
      const bad: unknown[] = [
        undefined,
        null,
        'x',
        123,
        [],
        {},
        { conversationId: 'abc' },
        { conversationId: 5 },
        { conversationId: { $ne: null } },
        { conversationId: "' OR 1=1 --" },
        { conversationId: '8f14e45f-ceea-4672-9d6b-6f8e3a7c1d10' }, // UUID hợp lệ nhưng không tồn tại
      ];

      for (const payload of bad) buyerSocket.emit(TYPING, payload);
      buyerSocket.emit(TYPING, { conversationId });
      await ownerGot.untilCount(1);
      await flush(buyerSocket, buyer);

      expect(buyerSocket.connected).toBe(true);
      expect(ownerGot.payloads).toEqual([{ conversationId }]);
    });

    it('hội thoại CHƯA có tin ⇒ đối phương không nhận gì (họ chưa hề thấy hội thoại này tồn tại)', async () => {
      const emptyOwner = await makeUser();
      const emptyConversation = await makeConversation(
        buyer.id,
        await makeShop(emptyOwner.id),
        false,
      );
      const [buyerSocket, emptyOwnerSocket] = [
        await open(buyer),
        await open(emptyOwner),
      ];
      const ownerGot = listen(emptyOwnerSocket);

      buyerSocket.emit(TYPING, { conversationId: emptyConversation });
      await flush(buyerSocket, buyer);

      expect(ownerGot.payloads).toEqual([]);
    });

    it('shop bị khoá (hội thoại chỉ đọc) ⇒ không còn tín hiệu gõ', async () => {
      const suspendedOwner = await makeUser();
      const suspendedConversation = await makeConversation(
        buyer.id,
        await makeShop(suspendedOwner.id, ShopStatus.SUSPENDED),
      );
      const [buyerSocket, suspendedSocket] = [
        await open(buyer),
        await open(suspendedOwner),
      ];
      const got = listen(suspendedSocket);

      buyerSocket.emit(TYPING, { conversationId: suspendedConversation });
      await flush(buyerSocket, buyer);

      expect(got.payloads).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------------------------------------
  describe('giới hạn tần suất', () => {
    it('hai sự kiện sát nhau cho cùng hội thoại ⇒ chủ shop chỉ nhận MỘT tín hiệu', async () => {
      const [buyerSocket, ownerSocket] = [await open(buyer), await open(owner)];
      const ownerGot = listen(ownerSocket);

      buyerSocket.emit(TYPING, { conversationId });
      buyerSocket.emit(TYPING, { conversationId });
      buyerSocket.emit(TYPING, { conversationId });
      await ownerGot.untilCount(1);
      await flush(buyerSocket, buyer);

      expect(ownerGot.payloads).toEqual([{ conversationId }]);
    });
  });

  // -------------------------------------------------------------------------------------------------------
  describe('bề mặt tấn công vẫn nhỏ khi có hai gateway', () => {
    it('gói lớn hơn ~1 KB ⇒ server ngắt kết nối (tuỳ chọn gói nhỏ vẫn có hiệu lực)', async () => {
      const socket = await open(buyer);
      const closed = new Promise<string>((resolve) => {
        socket.once('disconnect', (reason) => resolve(reason));
      });

      socket.emit(TYPING, { conversationId: 'a'.repeat(4096) });

      await expect(closed).resolves.toEqual(expect.any(String));
      expect(socket.connected).toBe(false);
    });

    it('sự kiện lạ do client tự bịa (vào phòng, ghi tin...) bị bỏ qua: không lỗi, không ngắt, người khác không nhận gì', async () => {
      const [buyerSocket, ownerSocket] = [await open(buyer), await open(owner)];
      const ownerGot = listen(ownerSocket);
      const anyEvents: string[] = [];
      buyerSocket.onAny((event: string) => anyEvents.push(event));

      buyerSocket.emit('join', { room: `user:${owner.id}` });
      buyerSocket.emit('chat:message', { conversationId, content: 'giả mạo' });
      buyerSocket.emit('subscribe', owner.id);
      await flush(buyerSocket, buyer);

      expect(buyerSocket.connected).toBe(true);
      expect(ownerGot.payloads).toEqual([]);
      // server không trả lời bằng bất kỳ sự kiện nào (kể cả `exception`)
      expect(anyEvents).toEqual([]);
    });
  });
});
