import type { TxClient } from '../../shared/prisma/tx-client';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { VoucherUsageService } from './voucher-usage.service';

// Unit test với `tx` GIẢ: kiểm thứ tự bước và idempotency. Tranh chấp đồng thời thật (2 checkout
// song song không cùng vượt usageLimit/perUserLimit) kiểm ở voucher-usage.service.int-spec.ts.

describe('VoucherUsageService (tx giả)', () => {
  let service: VoucherUsageService;
  let calls: string[];
  let tx: {
    $executeRaw: jest.Mock;
    voucher: { count: jest.Mock; updateMany: jest.Mock };
    voucherUsage: {
      count: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  const params = {
    voucherId: 'v1',
    userId: 'u1',
    checkoutGroupId: 'g1',
    discountAmount: 50000,
    perUserLimit: 1 as number | null,
  };

  beforeEach(() => {
    service = new VoucherUsageService();
    calls = [];
    tx = {
      $executeRaw: jest.fn(() => {
        calls.push('incrementUsedCount');
        return Promise.resolve(1);
      }),
      voucher: {
        count: jest.fn().mockResolvedValue(1),
        updateMany: jest.fn(() => {
          calls.push('decrementUsedCount');
          return Promise.resolve({ count: 1 });
        }),
      },
      voucherUsage: {
        count: jest.fn(() => {
          calls.push('countPerUser');
          return Promise.resolve(0);
        }),
        create: jest.fn(() => {
          calls.push('insertUsage');
          return Promise.resolve({});
        }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(() => {
          calls.push('flipReleasedAt');
          return Promise.resolve({ count: 1 });
        }),
      },
    };
  });

  const asTx = () => tx as unknown as TxClient;

  describe('consume', () => {
    it('đúng thứ tự: tăng usedCount → đếm perUserLimit → insert VoucherUsage', async () => {
      await service.consume(asTx(), params);

      expect(calls).toEqual([
        'incrementUsedCount',
        'countPerUser',
        'insertUsage',
      ]);
      expect(tx.voucherUsage.create).toHaveBeenCalledWith({
        data: {
          voucherId: 'v1',
          userId: 'u1',
          checkoutGroupId: 'g1',
          discountAmount: 50000,
        },
      });
    });

    it('hết lượt toàn hệ thống — 400 đúng chữ FE đang nhận diện, không đếm/insert', async () => {
      tx.$executeRaw.mockResolvedValue(0);

      await expectAppException(service.consume(asTx(), params), {
        status: 400,
        code: 'VOUCHER_USAGE_LIMIT_REACHED',
        message: 'Voucher usage limit has been reached',
      });
      expect(tx.voucherUsage.count).not.toHaveBeenCalled();
      expect(tx.voucherUsage.create).not.toHaveBeenCalled();
    });

    it('voucher không tồn tại — 404 thay vì báo hết lượt', async () => {
      tx.$executeRaw.mockResolvedValue(0);
      tx.voucher.count.mockResolvedValue(0);

      await expectAppException(service.consume(asTx(), params), {
        status: 404,
        code: 'VOUCHER_NOT_FOUND',
      });
    });

    it('đã đủ perUserLimit — 400 đúng chữ FE đang nhận diện, không insert (transaction rollback lượt vừa tăng)', async () => {
      tx.voucherUsage.count.mockResolvedValue(1);

      await expectAppException(service.consume(asTx(), params), {
        status: 400,
        code: 'VOUCHER_PER_USER_LIMIT_REACHED',
        message: 'You have reached the usage limit for this voucher',
      });
      expect(tx.voucherUsage.create).not.toHaveBeenCalled();
    });

    it('perUserLimit = null — không đếm theo user', async () => {
      await service.consume(asTx(), { ...params, perUserLimit: null });

      expect(tx.voucherUsage.count).not.toHaveBeenCalled();
      expect(tx.voucherUsage.create).toHaveBeenCalled();
    });

    it('đếm chỉ tính lượt CHƯA nhả của đúng voucher + user', async () => {
      await service.consume(asTx(), params);

      expect(tx.voucherUsage.count).toHaveBeenCalledWith({
        where: { voucherId: 'v1', userId: 'u1', releasedAt: null },
      });
    });
  });

  describe('release', () => {
    it('nhả lượt chưa nhả của nhóm: lật releasedAt rồi mới giảm usedCount', async () => {
      tx.voucherUsage.findMany.mockResolvedValue([
        { id: 'usage-1', voucherId: 'v1' },
      ]);

      const released = await service.release(asTx(), 'g1');

      expect(released).toBe(1);
      expect(calls).toEqual(['flipReleasedAt', 'decrementUsedCount']);
      expect(tx.voucherUsage.updateMany).toHaveBeenCalledWith({
        where: { id: 'usage-1', releasedAt: null },
        data: { releasedAt: expect.any(Date) as Date },
      });
      expect(tx.voucher.updateMany).toHaveBeenCalledWith({
        where: { id: 'v1', usedCount: { gt: 0 } },
        data: { usedCount: { decrement: 1 } },
      });
    });

    it('chỉ đọc lượt chưa nhả, theo voucher tăng dần (cùng thứ tự khoá với đường đặt hàng)', async () => {
      await service.release(asTx(), 'g1');

      expect(tx.voucherUsage.findMany).toHaveBeenCalledWith({
        where: { checkoutGroupId: 'g1', releasedAt: null },
        select: { id: true, voucherId: true },
        orderBy: { voucherId: 'asc' },
      });
    });

    it('gọi lặp/song song: lượt đã bị bên khác nhả (lật được 0 dòng) — KHÔNG giảm usedCount lần 2', async () => {
      tx.voucherUsage.findMany.mockResolvedValue([
        { id: 'usage-1', voucherId: 'v1' },
      ]);
      tx.voucherUsage.updateMany.mockResolvedValue({ count: 0 });

      const released = await service.release(asTx(), 'g1');

      expect(released).toBe(0);
      expect(tx.voucher.updateMany).not.toHaveBeenCalled();
    });

    it('nhóm không dùng voucher — không làm gì', async () => {
      await expect(service.release(asTx(), 'g1')).resolves.toBe(0);
      expect(tx.voucher.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('countActiveByUser', () => {
    it('đếm lượt chưa nhả, dùng được với client bất kỳ có voucherUsage', async () => {
      tx.voucherUsage.count.mockResolvedValue(2);

      await expect(service.countActiveByUser(asTx(), 'v1', 'u1')).resolves.toBe(
        2,
      );
    });
  });
});
