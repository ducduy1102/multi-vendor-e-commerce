import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notificationNewEventSchema, REALTIME_EVENTS } from '@ecommerce/types';
import { createFakeRealtimeEmitter } from '../testing/fake-realtime-emitter';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  NotificationEvent,
  NotificationFacts,
  OrderFacts,
} from './notification-events';
import type { NotificationFactsLoader } from './notification-facts.loader';
import { NotificationService } from './notification.service';

// NotificationService với bộ tải dữ kiện, Prisma và cổng real-time GIẢ (Week10.md 7.3): chứng minh hợp đồng "sau commit,
// không bao giờ ném, không log nội dung" và thứ tự tải → dựng → kiểm → ghi → đẩy. Quyết định "ai nhận gì" được kiểm riêng
// ở notification-events.spec.ts; truy vấn thật được kiểm ở notification.int-spec.ts.
const BUYER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const OTHER_OWNER = '33333333-3333-4333-8333-333333333333';
const ORDER_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const ORDER_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const CANARY = 'CANARY-lý-do-riêng-tư-9f3a';
const CREATED_AT = new Date('2030-01-01T10:00:00.000Z');

const order = (overrides: Partial<OrderFacts> = {}): OrderFacts => ({
  orderId: ORDER_1,
  buyerId: BUYER,
  shopOwnerId: OWNER,
  shopName: 'Cửa hàng Ánh Dương',
  visibleToSeller: true,
  ...overrides,
});
const ordersFacts = (...list: OrderFacts[]): NotificationFacts => ({
  kind: 'ORDERS',
  orders: list,
});

const PLACED: NotificationEvent = {
  kind: 'ORDERS_PLACED',
  checkoutGroupId: ORDER_2,
};
const CONFIRMED: NotificationEvent = {
  kind: 'ORDER_CONFIRMED',
  orderId: ORDER_1,
};

interface CreateArgs {
  data: { userId: string; type: string; data: unknown }[];
}

describe('NotificationService', () => {
  const createManyAndReturn = jest.fn<Promise<unknown>, [CreateArgs]>();
  const load = jest.fn();
  const realtime = createFakeRealtimeEmitter();
  const prisma = { notification: { createManyAndReturn } };
  let service: NotificationService;
  let errorLog: jest.SpyInstance;
  let warnLog: jest.SpyInstance;

  const messagesOf = (spy: jest.SpyInstance) =>
    (spy.mock.calls as unknown[][]).map((call) => String(call[0]));
  const loggedText = () =>
    [...messagesOf(errorLog), ...messagesOf(warnLog)].join('\n');

  beforeEach(() => {
    jest.resetAllMocks();
    realtime.reset();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnLog = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    createManyAndReturn.mockImplementation(({ data }: CreateArgs) =>
      Promise.resolve(
        data.map((row, index) => ({
          id: `00000000-0000-4000-8000-00000000000${index}`,
          userId: row.userId,
          type: row.type,
          data: row.data,
          readAt: null,
          createdAt: CREATED_AT,
        })),
      ),
    );
    service = new NotificationService(
      prisma as unknown as PrismaService,
      { load } as unknown as NotificationFactsLoader,
      realtime,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('luồng thành công', () => {
    it('tải dữ kiện → ghi MỘT lần cho cả lô → đẩy notification:new tới đúng từng người nhận', async () => {
      load.mockResolvedValue(
        ordersFacts(
          order(),
          order({ orderId: ORDER_2, shopOwnerId: OTHER_OWNER }),
        ),
      );

      await service.notify(PLACED);

      expect(load).toHaveBeenCalledWith(PLACED);
      expect(createManyAndReturn).toHaveBeenCalledTimes(1);
      const args = createManyAndReturn.mock.calls[0][0];
      expect(args.data).toEqual([
        { userId: OWNER, type: 'ORDER_NEW', data: { orderId: ORDER_1 } },
        { userId: OTHER_OWNER, type: 'ORDER_NEW', data: { orderId: ORDER_2 } },
      ]);
      expect(realtime.emitted.map((e) => e.userId)).toEqual([
        OWNER,
        OTHER_OWNER,
      ]);
      expect(
        realtime.emitted.every(
          (e) => e.event === REALTIME_EVENTS.notificationNew,
        ),
      ).toBe(true);
    });

    it('payload đẩy đi là thông báo ĐÃ GHI (có id thật, chưa đọc) và đúng hình dạng schema sự kiện', async () => {
      load.mockResolvedValue(ordersFacts(order()));

      await service.notify(CONFIRMED);

      expect(realtime.emitted).toHaveLength(1);
      const payload = notificationNewEventSchema.parse(
        realtime.emitted[0].payload,
      );
      expect(payload).toEqual({
        id: '00000000-0000-4000-8000-000000000000',
        type: 'ORDER_CONFIRMED',
        data: { orderId: ORDER_1, shopName: 'Cửa hàng Ánh Dương' },
        readAt: null,
        createdAt: '2030-01-01T10:00:00.000Z',
      });
    });

    it('chỉ đẩy cho người nhận của hàng đã ghi, không đẩy cho ai khác', async () => {
      load.mockResolvedValue(ordersFacts(order()));

      await service.notify(CONFIRMED);

      expect(realtime.emitted.map((e) => e.userId)).toEqual([BUYER]);
    });

    it('không có người nhận nào ⇒ không ghi, không đẩy, không log lỗi', async () => {
      load.mockResolvedValue(ordersFacts(order({ visibleToSeller: false })));

      await service.notify(PLACED);

      expect(createManyAndReturn).not.toHaveBeenCalled();
      expect(realtime.emitted).toEqual([]);
      expect(errorLog).not.toHaveBeenCalled();
    });

    it('bản ghi nguồn không còn (tải về null) ⇒ không ghi, chỉ cảnh báo, không ném', async () => {
      load.mockResolvedValue(null);

      await expect(service.notify(CONFIRMED)).resolves.toBeUndefined();

      expect(createManyAndReturn).not.toHaveBeenCalled();
      expect(realtime.emitted).toEqual([]);
      expect(warnLog).toHaveBeenCalledTimes(1);
      expect(loggedText()).toContain('ORDER_CONFIRMED');
    });
  });

  describe('KHÔNG BAO GIỜ ném — thao tác nghiệp vụ đã thành công', () => {
    it('bộ tải dữ kiện lỗi ⇒ resolve, chỉ log, không ghi', async () => {
      load.mockRejectedValue(new Error('db down'));

      await expect(service.notify(CONFIRMED)).resolves.toBeUndefined();

      expect(createManyAndReturn).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(loggedText()).toContain('ORDER_CONFIRMED');
      expect(loggedText()).toContain('db down');
    });

    it('dữ kiện sai loại cho sự kiện (lỗi lập trình) ⇒ resolve, chỉ log', async () => {
      load.mockResolvedValue({
        kind: 'SHOP',
        shop: { shopId: 's', shopName: 'n', ownerId: OWNER },
        adminIds: [],
      });

      await expect(service.notify(CONFIRMED)).resolves.toBeUndefined();

      expect(createManyAndReturn).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledTimes(1);
    });

    it('ghi DB lỗi ⇒ resolve, KHÔNG đẩy gì (không báo thứ chưa được lưu)', async () => {
      load.mockResolvedValue(ordersFacts(order()));
      createManyAndReturn.mockRejectedValue(new Error('insert failed'));

      await expect(service.notify(CONFIRMED)).resolves.toBeUndefined();

      expect(realtime.emitted).toEqual([]);
      expect(errorLog).toHaveBeenCalledTimes(1);
    });

    it('cổng real-time lỗi ⇒ resolve; thông báo đã nằm trong DB nên người dùng vẫn thấy khi tải lại', async () => {
      load.mockResolvedValue(ordersFacts(order()));
      realtime.failWith(new Error('socket down'));

      await expect(service.notify(CONFIRMED)).resolves.toBeUndefined();

      expect(createManyAndReturn).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(loggedText()).toContain('socket down');
    });

    it('một người nhận đẩy lỗi KHÔNG chặn người nhận khác', async () => {
      load.mockResolvedValue(
        ordersFacts(
          order(),
          order({ orderId: ORDER_2, shopOwnerId: OTHER_OWNER }),
        ),
      );
      const delivered: string[] = [];
      const flaky = {
        emitToUser: (userId: string) => {
          if (userId === OWNER) return Promise.reject(new Error('one failed'));
          delivered.push(userId);
          return Promise.resolve();
        },
        disconnectUser: () => Promise.resolve(),
      };
      service = new NotificationService(
        prisma as unknown as PrismaService,
        { load } as unknown as NotificationFactsLoader,
        flaky,
      );

      await expect(service.notify(PLACED)).resolves.toBeUndefined();

      expect(delivered).toEqual([OTHER_OWNER]);
      expect(errorLog).toHaveBeenCalledTimes(1);
    });

    it('MỖI lần đẩy lỗi được log riêng, để biết người nhận nào đã không được báo ngay (không chỉ lần lỗi đầu tiên)', async () => {
      load.mockResolvedValue(
        ordersFacts(
          order(),
          order({ orderId: ORDER_2, shopOwnerId: OTHER_OWNER }),
        ),
      );
      realtime.failWith(new Error('socket down'));

      await service.notify(PLACED);

      expect(errorLog).toHaveBeenCalledTimes(2);
      expect(loggedText()).toContain('Pushing notification');
      expect(loggedText()).not.toContain('Creating notifications');
    });

    it('mọi lần gọi đều resolve với undefined, kể cả khi mọi tầng cùng lỗi', async () => {
      load.mockRejectedValue(new Error('x'));
      realtime.failWith();

      await expect(service.notify(CONFIRMED)).resolves.toBeUndefined();
      await expect(service.notify(PLACED)).resolves.toBeUndefined();
    });
  });

  describe('kiểm bằng schema trước khi ghi', () => {
    it('một thông báo hỏng bị bỏ và log, các thông báo hợp lệ trong lô VẪN được ghi và đẩy', async () => {
      load.mockResolvedValue(
        ordersFacts(
          order({ orderId: 'không-phải-uuid' }),
          order({ orderId: ORDER_2, shopOwnerId: OTHER_OWNER }),
        ),
      );

      await service.notify(PLACED);

      const args = createManyAndReturn.mock.calls[0][0];
      expect(args.data).toEqual([
        { userId: OTHER_OWNER, type: 'ORDER_NEW', data: { orderId: ORDER_2 } },
      ]);
      expect(realtime.emitted.map((e) => e.userId)).toEqual([OTHER_OWNER]);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(loggedText()).toContain('ORDER_NEW');
      expect(loggedText()).toContain('orderId');
      // Log nói TRƯỜNG nào sai và vì sao, không in giá trị đã nhập.
      expect(loggedText()).not.toContain('không-phải-uuid');
    });

    it('cả lô đều hỏng ⇒ không gọi ghi', async () => {
      load.mockResolvedValue(ordersFacts(order({ orderId: 'x' })));

      await service.notify(PLACED);

      expect(createManyAndReturn).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledTimes(1);
    });
  });

  describe('log không làm lộ nội dung', () => {
    it('lỗi xác thực của Prisma (in NGUYÊN giá trị đã ghi) chỉ được log dưới dạng đã lược bỏ chi tiết', async () => {
      load.mockResolvedValue(ordersFacts(order({ shopName: CANARY })));
      createManyAndReturn.mockRejectedValue(
        new Prisma.PrismaClientValidationError(
          `Invalid invocation: data: { shopName: "${CANARY}" }`,
          { clientVersion: 'test' },
        ),
      );

      await service.notify(CONFIRMED);

      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(loggedText()).not.toContain(CANARY);
      expect(loggedText()).toContain('PrismaClientValidationError');
    });

    it('lỗi ràng buộc của Postgres (có thể kèm hàng vi phạm) chỉ log tên lỗi và mã', async () => {
      load.mockResolvedValue(ordersFacts(order({ shopName: CANARY })));
      createManyAndReturn.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          `Failing row contains (${CANARY})`,
          { code: 'P2004', clientVersion: 'test' },
        ),
      );

      await service.notify(CONFIRMED);

      expect(loggedText()).not.toContain(CANARY);
      expect(loggedText()).toContain('P2004');
    });

    it('lý do người dùng nhập không bao giờ xuất hiện trong log ở luồng thành công lẫn thất bại', async () => {
      load.mockResolvedValue(ordersFacts(order()));
      const cancel: NotificationEvent = {
        kind: 'ORDERS_CANCELLED',
        target: { orderIds: [ORDER_1] },
        by: 'SELLER',
        reason: CANARY,
      };

      await service.notify(cancel);
      createManyAndReturn.mockRejectedValue(new Error('insert failed'));
      await service.notify(cancel);
      realtime.failWith(new Error('socket down'));
      createManyAndReturn.mockImplementation(({ data }: CreateArgs) =>
        Promise.resolve(
          data.map((row) => ({
            id: '00000000-0000-4000-8000-000000000009',
            ...row,
            readAt: null,
            createdAt: CREATED_AT,
          })),
        ),
      );
      await service.notify(cancel);

      expect(errorLog).toHaveBeenCalled();
      expect(loggedText()).not.toContain(CANARY);
    });

    it('thông điệp lỗi quá dài bị cắt gọn', async () => {
      load.mockRejectedValue(new Error('x'.repeat(5000)));

      await service.notify(CONFIRMED);

      expect(loggedText().length).toBeLessThan(400);
    });
  });
});
