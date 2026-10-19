import { Logger } from '@nestjs/common';
import { messageHandlersOf } from '../../shared/testing/message-handlers';
import { chatTypingPayloadSchema } from '@ecommerce/types';
import {
  createFakeRealtimeEmitter,
  type FakeRealtimeEmitter,
} from '../../shared/testing/fake-realtime-emitter';
import { RealtimeGateway } from '../../shared/realtime/realtime.gateway';
import { REALTIME_GATEWAY_OPTIONS } from '../../shared/realtime/realtime.constants';
import type { RealtimeSocket } from '../../shared/realtime/realtime.types';
import {
  CHAT_TYPING_FLOOD_MAX_EVENTS,
  CHAT_TYPING_MEMBER_TTL_MS,
  CHAT_TYPING_MIN_INTERVAL_MS,
  CHAT_TYPING_NON_MEMBER_TTL_MS,
} from './chat-config';
import { ChatGateway } from './chat.gateway';
import type { ChatService } from './chat.service';

const CONVERSATION = '8f14e45f-ceea-4672-9d6b-6f8e3a7c1d10';
const OTHER_CONVERSATION = '1679091c-5a88-4faf-afb5-e6e2f2d6a001';
const SENDER = 'user-sender';
const RECIPIENT = 'user-recipient';
const NOW = new Date('2030-01-02T12:00:00.000Z');

let socketCounter = 0;
function socketOf(userId: string | null = SENDER): RealtimeSocket {
  return {
    id: `socket-${socketCounter++}`,
    handshake: { headers: {}, address: '127.0.0.1' },
    data: userId
      ? { user: { userId, role: 'USER', exp: 4_102_444_800 }, connectedAt: 0 }
      : {},
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as RealtimeSocket;
}

const firstLogArgument = (spy: jest.SpyInstance): unknown =>
  (spy.mock.calls as unknown[][])[0][0];

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let realtime: FakeRealtimeEmitter;
  let resolveRecipient: jest.Mock;

  const typing = (client: RealtimeSocket, ...rest: [body?: unknown]) =>
    gateway.handleTyping(
      client,
      rest.length > 0 ? rest[0] : { conversationId: CONVERSATION },
    );
  const advance = (ms: number) => jest.advanceTimersByTime(ms);

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    realtime = createFakeRealtimeEmitter();
    resolveRecipient = jest.fn().mockResolvedValue(RECIPIENT);
    gateway = new ChatGateway(
      { resolveTypingRecipient: resolveRecipient } as unknown as ChatService,
      realtime,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('chuyển tín hiệu', () => {
    it('thành viên gõ ⇒ đối phương (suy ra từ DB) nhận chat:typing với đúng { conversationId }', async () => {
      await typing(socketOf());

      expect(resolveRecipient).toHaveBeenCalledWith(SENDER, CONVERSATION);
      expect(realtime.emitted).toEqual([
        {
          userId: RECIPIENT,
          event: 'chat:typing',
          payload: { conversationId: CONVERSATION },
        },
      ]);
      expect(
        chatTypingPayloadSchema.strict().parse(realtime.emitted[0].payload),
      ).toEqual({ conversationId: CONVERSATION });
    });

    it('KHÔNG BAO GIỜ gửi tới chính người gõ (các tab khác của họ cũng không)', async () => {
      await typing(socketOf());

      expect(realtime.emitted.map((e) => e.userId)).not.toContain(SENDER);
    });

    it('trường lạ trong payload (toUserId, recipient, content...) bị bỏ — client không chỉ định được người nhận', async () => {
      await typing(socketOf(), {
        conversationId: CONVERSATION,
        toUserId: 'victim',
        recipientId: 'victim',
        userId: 'victim',
        content: 'nội dung lạ',
      });

      expect(realtime.emitted).toHaveLength(1);
      expect(realtime.emitted[0].userId).toBe(RECIPIENT);
      expect(realtime.emitted[0].payload).toEqual({
        conversationId: CONVERSATION,
      });
      expect(resolveRecipient).toHaveBeenCalledWith(SENDER, CONVERSATION);
    });

    it('không trả gì cho client (không ack, không phản hồi): handler resolve undefined', async () => {
      await expect(typing(socketOf())).resolves.toBeUndefined();
    });
  });

  describe('đầu vào không hợp lệ ⇒ bỏ im lặng, không chạm DB', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['chuỗi', 'x'],
      ['số', 123],
      ['mảng', [CONVERSATION]],
      ['object rỗng', {}],
      ['conversationId không phải UUID', { conversationId: 'abc' }],
      ['conversationId là số', { conversationId: 5 }],
      ['conversationId là object', { conversationId: { $ne: null } }],
      ['conversationId chứa SQL', { conversationId: "' OR 1=1 --" }],
      ['conversationId rỗng', { conversationId: '' }],
    ])('%s', async (_name, body) => {
      await expect(typing(socketOf(), body)).resolves.toBeUndefined();

      expect(resolveRecipient).not.toHaveBeenCalled();
      expect(realtime.emitted).toEqual([]);
    });

    it('socket chưa xác thực (không có socket.data.user) ⇒ bỏ, không hỏi DB', async () => {
      await typing(socketOf(null));

      expect(resolveRecipient).not.toHaveBeenCalled();
      expect(realtime.emitted).toEqual([]);
    });
  });

  describe('không phải thành viên', () => {
    beforeEach(() => resolveRecipient.mockResolvedValue(null));

    it('không đẩy gì, không lỗi, không phản hồi (không dò được hội thoại có thật)', async () => {
      await expect(typing(socketOf())).resolves.toBeUndefined();

      expect(realtime.emitted).toEqual([]);
    });

    it('kết quả "không phải thành viên" được nhớ: gõ lại sau khoảng tối thiểu KHÔNG hỏi DB lần nữa', async () => {
      const client = socketOf();
      await typing(client);
      advance(CHAT_TYPING_MIN_INTERVAL_MS);
      await typing(client);
      advance(CHAT_TYPING_MIN_INTERVAL_MS);
      await typing(client);

      expect(resolveRecipient).toHaveBeenCalledTimes(1);
    });

    it('hết hạn nhớ ngắn ⇒ hỏi lại (hội thoại mới tạo không bị từ chối mãi)', async () => {
      const client = socketOf();
      await typing(client);
      advance(CHAT_TYPING_NON_MEMBER_TTL_MS);
      resolveRecipient.mockResolvedValue(RECIPIENT);

      await typing(client);

      expect(resolveRecipient).toHaveBeenCalledTimes(2);
      expect(realtime.emitted).toHaveLength(1);
    });
  });

  describe('giới hạn tần suất', () => {
    it('hai sự kiện sát nhau cho cùng hội thoại ⇒ chỉ một tín hiệu được chuyển', async () => {
      const client = socketOf();

      await typing(client);
      advance(CHAT_TYPING_MIN_INTERVAL_MS - 1);
      await typing(client);

      expect(realtime.emitted).toHaveLength(1);
    });

    it('đủ khoảng tối thiểu ⇒ chuyển tiếp', async () => {
      const client = socketOf();

      await typing(client);
      advance(CHAT_TYPING_MIN_INTERVAL_MS);
      await typing(client);

      expect(realtime.emitted).toHaveLength(2);
    });

    it('mỗi hội thoại một khoảng riêng', async () => {
      const client = socketOf();

      await typing(client, { conversationId: CONVERSATION });
      await typing(client, { conversationId: OTHER_CONVERSATION });

      expect(realtime.emitted.map((e) => e.payload)).toEqual([
        { conversationId: CONVERSATION },
        { conversationId: OTHER_CONVERSATION },
      ]);
    });

    it('mỗi socket một trạng thái riêng: hai tab của cùng người dùng gõ cùng lúc đều được chuyển', async () => {
      await typing(socketOf());
      await typing(socketOf());

      expect(realtime.emitted).toHaveLength(2);
    });

    it('hai sự kiện đến ĐỒNG THỜI khi DB còn đang trả lời ⇒ chỉ hỏi DB một lần và chuyển một tín hiệu', async () => {
      let release: (id: string) => void = () => undefined;
      resolveRecipient.mockImplementation(
        () => new Promise<string>((resolve) => (release = resolve)),
      );
      const client = socketOf();

      const first = typing(client);
      const second = typing(client);
      release(RECIPIENT);
      await Promise.all([first, second]);

      expect(resolveRecipient).toHaveBeenCalledTimes(1);
      expect(realtime.emitted).toHaveLength(1);
    });

    it('chặn lụt: gửi bừa nhiều hội thoại khác nhau ⇒ chỉ CHAT_TYPING_FLOOD_MAX_EVENTS sự kiện đầu được xử lý (chạm DB)', async () => {
      const client = socketOf();
      const total = CHAT_TYPING_FLOOD_MAX_EVENTS + 15;

      for (let i = 0; i < total; i++) {
        await typing(client, {
          conversationId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        });
      }

      expect(resolveRecipient).toHaveBeenCalledTimes(
        CHAT_TYPING_FLOOD_MAX_EVENTS,
      );
    });

    it('sự kiện SAI ĐỊNH DẠNG cũng tính vào chặn lụt (không dùng để lách trần)', async () => {
      const client = socketOf();
      for (let i = 0; i < CHAT_TYPING_FLOOD_MAX_EVENTS; i++) {
        await typing(client, { conversationId: 'abc' });
      }

      await typing(client);

      expect(resolveRecipient).not.toHaveBeenCalled();
    });
  });

  describe('nhớ thành viên theo socket', () => {
    it('gõ liên tục nhiều lần ⇒ chỉ hỏi DB MỘT lần, các lần sau dùng bản nhớ', async () => {
      const client = socketOf();

      for (let i = 0; i < 5; i++) {
        await typing(client);
        advance(CHAT_TYPING_MIN_INTERVAL_MS);
      }

      expect(resolveRecipient).toHaveBeenCalledTimes(1);
      expect(realtime.emitted).toHaveLength(5);
    });

    it('hết hạn nhớ ⇒ hỏi lại DB', async () => {
      const client = socketOf();
      await typing(client);
      advance(CHAT_TYPING_MEMBER_TTL_MS);

      await typing(client);

      expect(resolveRecipient).toHaveBeenCalledTimes(2);
    });

    it('mỗi socket tự hỏi: bản nhớ của socket này không dùng cho socket khác', async () => {
      await typing(socketOf());
      await typing(socketOf());

      expect(resolveRecipient).toHaveBeenCalledTimes(2);
    });
  });

  describe('lỗi không bao giờ lọt ra ngoài và không làm lộ dữ liệu', () => {
    let logged: jest.SpyInstance;

    beforeEach(() => {
      logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    });

    it('DB lỗi ⇒ handler không ném (Nest sẽ gửi sự kiện exception về client nếu ném), chỉ log thông điệp lỗi', async () => {
      resolveRecipient.mockRejectedValue(new Error('db down'));

      await expect(typing(socketOf())).resolves.toBeUndefined();

      expect(realtime.emitted).toEqual([]);
      expect(logged).toHaveBeenCalledTimes(1);
      const message = String(firstLogArgument(logged));
      expect(message).toContain('db down');
      expect(message).not.toContain(CONVERSATION);
      expect(message).not.toContain(SENDER);
      expect(message).not.toContain(RECIPIENT);
    });

    it('cổng đẩy lỗi ⇒ handler không ném', async () => {
      realtime.failWith(new Error('socket down'));

      await expect(typing(socketOf())).resolves.toBeUndefined();

      expect(logged).toHaveBeenCalledTimes(1);
      expect(String(firstLogArgument(logged))).toContain('socket down');
    });

    it('lỗi không phải Error cũng không làm handler ném', async () => {
      resolveRecipient.mockRejectedValue('chuỗi lạ');

      await expect(typing(socketOf())).resolves.toBeUndefined();
    });
  });

  describe('bề mặt tấn công của gateway', () => {
    it('có ĐÚNG MỘT @SubscribeMessage là chat:typing — không có sự kiện tự vào phòng, ghi dữ liệu hay gì khác', () => {
      const handlers = messageHandlersOf(ChatGateway);

      expect(handlers).toEqual([['handleTyping', 'chat:typing']]);
    });

    it('dùng đúng cùng tuỳ chọn Socket.io như RealtimeGateway (Nest chỉ tạo một server, lấy tuỳ chọn của gateway quét trước)', () => {
      const chatOptions = Reflect.getMetadata(
        'websockets:gateway_options',
        ChatGateway,
      ) as unknown;
      const realtimeOptions = Reflect.getMetadata(
        'websockets:gateway_options',
        RealtimeGateway,
      ) as unknown;

      expect(chatOptions).toEqual(REALTIME_GATEWAY_OPTIONS);
      expect(realtimeOptions).toEqual(REALTIME_GATEWAY_OPTIONS);
      expect(REALTIME_GATEWAY_OPTIONS).toMatchObject({
        transports: ['websocket'],
        serveClient: false,
      });
    });

    it('RealtimeGateway vẫn KHÔNG có @SubscribeMessage nào', () => {
      expect(messageHandlersOf(RealtimeGateway)).toEqual([]);
    });
  });
});
