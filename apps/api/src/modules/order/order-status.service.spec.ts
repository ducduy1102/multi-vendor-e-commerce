import type { TxClient } from '../../shared/prisma/tx-client';
import {
  InvalidOrderTransitionError,
  OrderStatusService,
} from './order-status.service';

describe('OrderStatusService', () => {
  let service: OrderStatusService;
  let tx: {
    $queryRaw: jest.Mock;
    orderStatusHistory: { createMany: jest.Mock };
  };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      orderStatusHistory: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    service = new OrderStatusService();
  });

  const run = (
    ids: string[],
    from: Parameters<OrderStatusService['transition']>[2],
    to: Parameters<OrderStatusService['transition']>[3],
    actor: Parameters<OrderStatusService['transition']>[4] = {
      type: 'SYSTEM',
    },
    note?: string,
  ) =>
    service.transition(tx as unknown as TxClient, ids, from, to, actor, note);

  describe('transition', () => {
    it('cạnh không hợp lệ — ném InvalidOrderTransitionError, không chạm DB', async () => {
      await expect(run(['o1'], 'CANCELLED', 'PENDING')).rejects.toThrow(
        InvalidOrderTransitionError,
      );
      await expect(run(['o1'], 'PENDING', 'SHIPPING')).rejects.toThrow(
        'Invalid order status transition: PENDING -> SHIPPING',
      );
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.orderStatusHistory.createMany).not.toHaveBeenCalled();
    });

    it('danh sách đơn rỗng — trả [] không chạm DB', async () => {
      await expect(run([], 'PENDING', 'CONFIRMED')).resolves.toEqual([]);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('lật được — trả id đã lật (sắp tăng dần) và ghi 1 dòng history cho MỖI đơn', async () => {
      tx.$queryRaw.mockResolvedValue([{ id: 'o2' }, { id: 'o1' }]);

      const flipped = await run(
        ['o2', 'o1', 'o2'],
        'AWAITING_PAYMENT',
        'PENDING',
        { type: 'SYSTEM' },
        'Payment confirmed',
      );

      expect(flipped).toEqual(['o1', 'o2']);
      expect(tx.orderStatusHistory.createMany).toHaveBeenCalledWith({
        data: [
          {
            orderId: 'o1',
            fromStatus: 'AWAITING_PAYMENT',
            toStatus: 'PENDING',
            actorType: 'SYSTEM',
            actorId: null,
            note: 'Payment confirmed',
            createdAt: expect.any(Date) as Date,
          },
          {
            orderId: 'o2',
            fromStatus: 'AWAITING_PAYMENT',
            toStatus: 'PENDING',
            actorType: 'SYSTEM',
            actorId: null,
            note: 'Payment confirmed',
            createdAt: expect.any(Date) as Date,
          },
        ],
      });
    });

    it('actor không phải SYSTEM — ghi actorId', async () => {
      tx.$queryRaw.mockResolvedValue([{ id: 'o1' }]);

      await run(['o1'], 'PENDING', 'CONFIRMED', {
        type: 'SELLER',
        id: 'user-seller',
      });

      expect(tx.orderStatusHistory.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            actorType: 'SELLER',
            actorId: 'user-seller',
            note: null,
          }) as unknown,
        ],
      });
    });

    it('không đơn nào lật được (đã sang trạng thái khác) — trả [] và KHÔNG ghi history', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(run(['o1'], 'PENDING', 'CONFIRMED')).resolves.toEqual([]);
      expect(tx.orderStatusHistory.createMany).not.toHaveBeenCalled();
    });

    it('chỉ ghi history cho đơn thật sự lật (đơn thua cuộc trong nhóm không có dòng)', async () => {
      tx.$queryRaw.mockResolvedValue([{ id: 'o1' }]); // o2 đã bị đổi trước đó

      const flipped = await run(['o1', 'o2'], 'PENDING', 'CANCELLED');

      expect(flipped).toEqual(['o1']);
      expect(tx.orderStatusHistory.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ orderId: 'o1' }) as unknown],
      });
    });
  });

  describe('recordCreated', () => {
    it('ghi mốc tạo đơn với fromStatus null cho mọi đơn', async () => {
      await service.recordCreated(
        tx as unknown as TxClient,
        [
          { id: 'o1', status: 'AWAITING_PAYMENT' },
          { id: 'o2', status: 'PENDING' },
        ],
        { type: 'BUYER', id: 'user-1' },
      );

      expect(tx.orderStatusHistory.createMany).toHaveBeenCalledWith({
        data: [
          {
            orderId: 'o1',
            fromStatus: null,
            toStatus: 'AWAITING_PAYMENT',
            actorType: 'BUYER',
            actorId: 'user-1',
            createdAt: expect.any(Date) as Date,
          },
          {
            orderId: 'o2',
            fromStatus: null,
            toStatus: 'PENDING',
            actorType: 'BUYER',
            actorId: 'user-1',
            createdAt: expect.any(Date) as Date,
          },
        ],
      });
    });

    it('không có đơn — không gọi DB', async () => {
      await service.recordCreated(tx as unknown as TxClient, [], {
        type: 'SYSTEM',
      });
      expect(tx.orderStatusHistory.createMany).not.toHaveBeenCalled();
    });
  });
});
