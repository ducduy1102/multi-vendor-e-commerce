import { ORDER_STATUSES_VISIBLE_TO_SELLER } from '@ecommerce/types';
import type { OrderStatus, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import type { InventoryService } from '../product/inventory.service';
import { OrderActionService } from './order-action.service';
import type { OrderEmailService } from './order-email.service';
import type { OrderStatusService } from './order-status.service';
import type { PaymentService } from './payment.service';

function loaded(
  status: OrderStatus,
  method: PaymentMethod | null = 'VNPAY',
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'o1',
    status,
    checkoutGroupId: 'g1',
    items: [
      { productVariantId: 'v1', quantity: 2 },
      { productVariantId: 'v2', quantity: 1 },
    ],
    checkoutGroup: { payments: method ? [{ method }] : [] },
    ...overrides,
  };
}

describe('OrderActionService', () => {
  let service: OrderActionService;
  let tx: {
    order: { findFirst: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    payment: { updateMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let prisma: {
    $transaction: jest.Mock;
    order: { findFirst: jest.Mock };
  };
  let orderStatusService: { transition: jest.Mock };
  let inventoryService: { restock: jest.Mock };
  let paymentService: { cancelCheckoutGroup: jest.Mock };
  let orderEmailService: {
    notifyConfirmed: jest.Mock;
    notifyShipped: jest.Mock;
    notifyCancelled: jest.Mock;
  };
  // Ghi lại thứ tự gọi để kiểm thứ tự khoá (khoá nhóm TRƯỚC khi chuyển trạng thái).
  let calls: string[];

  beforeEach(() => {
    calls = [];
    tx = {
      order: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $queryRaw: jest.fn().mockImplementation(() => {
        calls.push('lockGroup');
        return Promise.resolve([]);
      }),
    };
    prisma = {
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      order: { findFirst: jest.fn() },
    };
    orderStatusService = {
      transition: jest.fn().mockImplementation(() => {
        calls.push('transition');
        return Promise.resolve(['o1']);
      }),
    };
    inventoryService = { restock: jest.fn().mockResolvedValue(undefined) };
    paymentService = { cancelCheckoutGroup: jest.fn().mockResolvedValue({}) };
    orderEmailService = {
      notifyConfirmed: jest.fn().mockResolvedValue(undefined),
      notifyShipped: jest.fn().mockResolvedValue(undefined),
      notifyCancelled: jest.fn().mockResolvedValue(undefined),
    };
    service = new OrderActionService(
      prisma as unknown as PrismaService,
      orderStatusService as unknown as OrderStatusService,
      inventoryService as unknown as InventoryService,
      paymentService as unknown as PaymentService,
      orderEmailService as unknown as OrderEmailService,
    );
  });

  const SELLER = { type: 'SELLER', id: 'seller-1' };
  const BUYER = { type: 'BUYER', id: 'buyer-1' };

  describe('email báo buyer (Week8.md 2.8) — sau commit, chỉ khi hành động thành công', () => {
    it('confirm thành công — gửi email "shop đã xác nhận" cho đúng đơn', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('PENDING'));

      await service.confirm('shop-1', 'seller-1', 'o1');

      expect(orderEmailService.notifyConfirmed).toHaveBeenCalledWith('o1');
    });

    it('ship thành công — gửi email "đang giao"', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('PACKED'));

      await service.ship('shop-1', 'seller-1', 'o1', { carrier: 'GHN' });

      expect(orderEmailService.notifyShipped).toHaveBeenCalledWith('o1');
    });

    it('pack — KHÔNG gửi email (bước nội bộ của shop)', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('CONFIRMED'));

      await service.pack('shop-1', 'seller-1', 'o1');

      expect(orderEmailService.notifyConfirmed).not.toHaveBeenCalled();
      expect(orderEmailService.notifyShipped).not.toHaveBeenCalled();
      expect(orderEmailService.notifyCancelled).not.toHaveBeenCalled();
    });

    it('seller từ chối — gửi email hủy với người hủy SELLER và lý do', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('PENDING', 'COD'));

      await service.reject('shop-1', 'seller-1', 'o1', 'Hết hàng');

      expect(orderEmailService.notifyCancelled).toHaveBeenCalledWith(
        { orderIds: ['o1'] },
        'SELLER',
        'Hết hàng',
      );
    });

    it('buyer hủy đơn COD — gửi email hủy với người hủy BUYER (lý do null nếu không nhập)', async () => {
      prisma.order.findFirst.mockResolvedValue({
        status: 'PENDING',
        checkoutGroupId: 'g1',
      });
      tx.order.findFirst.mockResolvedValue(loaded('PENDING', 'COD'));

      await service.cancelByBuyer('buyer-1', 'o1');

      expect(orderEmailService.notifyCancelled).toHaveBeenCalledWith(
        { orderIds: ['o1'] },
        'BUYER',
        null,
      );
    });

    it('buyer hủy đơn CHƯA thanh toán — email do reclaimCheckoutGroup gửi (1 email/nhóm), nhánh này KHÔNG gửi thêm', async () => {
      prisma.order.findFirst.mockResolvedValue({
        status: 'AWAITING_PAYMENT',
        checkoutGroupId: 'g1',
      });

      await service.cancelByBuyer('buyer-1', 'o1');

      expect(orderEmailService.notifyCancelled).not.toHaveBeenCalled();
    });

    it('hành động THẤT BẠI (sai trạng thái / thua race / không được hủy) — KHÔNG gửi email nào', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('CANCELLED'));
      await expect(
        service.confirm('shop-1', 'seller-1', 'o1'),
      ).rejects.toBeDefined();

      tx.order.findFirst.mockResolvedValue(loaded('PENDING', 'VNPAY'));
      await expect(
        service.reject('shop-1', 'seller-1', 'o1', 'x'),
      ).rejects.toBeDefined();

      tx.order.findFirst.mockResolvedValue(loaded('PACKED'));
      orderStatusService.transition.mockResolvedValue([]);
      await expect(
        service.ship('shop-1', 'seller-1', 'o1', {}),
      ).rejects.toBeDefined();

      expect(orderEmailService.notifyConfirmed).not.toHaveBeenCalled();
      expect(orderEmailService.notifyShipped).not.toHaveBeenCalled();
      expect(orderEmailService.notifyCancelled).not.toHaveBeenCalled();
    });
  });

  describe('confirm / pack', () => {
    it('confirm: đọc đơn theo ĐÚNG phạm vi shop + chỉ trạng thái Seller được thấy (không AWAITING_PAYMENT), chuyển PENDING → CONFIRMED bởi seller', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('PENDING'));

      await service.confirm('shop-1', 'seller-1', 'o1');

      expect(tx.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'o1',
            shopId: 'shop-1',
            status: { in: ORDER_STATUSES_VISIBLE_TO_SELLER },
          },
        }),
      );
      expect(orderStatusService.transition).toHaveBeenCalledWith(
        tx,
        ['o1'],
        'PENDING',
        'CONFIRMED',
        SELLER,
        undefined,
      );
    });

    it('pack: CONFIRMED → PACKED', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('CONFIRMED'));

      await service.pack('shop-1', 'seller-1', 'o1');

      expect(orderStatusService.transition).toHaveBeenCalledWith(
        tx,
        ['o1'],
        'CONFIRMED',
        'PACKED',
        SELLER,
        undefined,
      );
    });

    it.each([
      'AWAITING_PAYMENT',
      'CONFIRMED',
      'SHIPPING',
      'CANCELLED',
    ] as const)(
      'confirm khi đơn đang %s — 409 ORDER_INVALID_TRANSITION, không chuyển',
      async (status) => {
        tx.order.findFirst.mockResolvedValue(loaded(status));

        await expectAppException(service.confirm('shop-1', 'seller-1', 'o1'), {
          status: 409,
          code: 'ORDER_INVALID_TRANSITION',
        });
        expect(orderStatusService.transition).not.toHaveBeenCalled();
      },
    );

    it('đơn không thuộc shop / không tồn tại — 404 ORDER_NOT_FOUND', async () => {
      tx.order.findFirst.mockResolvedValue(null);

      await expectAppException(service.confirm('shop-1', 'seller-1', 'x'), {
        status: 404,
        code: 'ORDER_NOT_FOUND',
      });
    });

    it('thua race (đọc còn PENDING nhưng lúc cập nhật đã bị đổi) — 409 ORDER_ALREADY_CHANGED', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('PENDING'));
      orderStatusService.transition.mockResolvedValue([]);

      await expectAppException(service.confirm('shop-1', 'seller-1', 'o1'), {
        status: 409,
        code: 'ORDER_ALREADY_CHANGED',
      });
    });
  });

  describe('ship', () => {
    it('PACKED → SHIPPING và ghi đơn vị vận chuyển + mã vận đơn cùng transaction', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('PACKED'));

      await service.ship('shop-1', 'seller-1', 'o1', {
        carrier: 'GHN',
        trackingCode: 'GHN123',
      });

      expect(orderStatusService.transition).toHaveBeenCalledWith(
        tx,
        ['o1'],
        'PACKED',
        'SHIPPING',
        SELLER,
        undefined,
      );
      expect(tx.order.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { carrier: 'GHN', trackingCode: 'GHN123' },
      });
    });

    it('không nhập gì — vẫn giao được, vận chuyển để null', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('PACKED'));

      await service.ship('shop-1', 'seller-1', 'o1', {});

      expect(tx.order.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { carrier: null, trackingCode: null },
      });
    });

    it('thua race — không ghi vận chuyển', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('PACKED'));
      orderStatusService.transition.mockResolvedValue([]);

      await expectAppException(
        service.ship('shop-1', 'seller-1', 'o1', { carrier: 'GHN' }),
        { status: 409, code: 'ORDER_ALREADY_CHANGED' },
      );
      expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('đơn chưa đóng gói — 409 ORDER_INVALID_TRANSITION', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('CONFIRMED'));

      await expectAppException(service.ship('shop-1', 'seller-1', 'o1', {}), {
        status: 409,
        code: 'ORDER_INVALID_TRANSITION',
      });
    });
  });

  describe('reject (seller)', () => {
    it('đơn COD chờ xác nhận: PENDING → CANCELLED, lý do vào note, CỘNG LẠI kho đúng từng dòng', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('PENDING', 'COD'));

      await service.reject('shop-1', 'seller-1', 'o1', 'Hết hàng');

      expect(orderStatusService.transition).toHaveBeenCalledWith(
        tx,
        ['o1'],
        'PENDING',
        'CANCELLED',
        SELLER,
        'Hết hàng',
      );
      expect(inventoryService.restock).toHaveBeenCalledWith(tx, [
        { productVariantId: 'v1', quantity: 2 },
        { productVariantId: 'v2', quantity: 1 },
      ]);
    });

    it.each(['VNPAY', 'MOMO'] as const)(
      'đơn đã trả online (%s): 409 ORDER_CANCEL_NOT_ALLOWED / PAID_ONLINE, không chuyển, không hoàn kho',
      async (method) => {
        tx.order.findFirst.mockResolvedValue(loaded('PENDING', method));

        await expectAppException(
          service.reject('shop-1', 'seller-1', 'o1', 'Hết hàng'),
          {
            status: 409,
            code: 'ORDER_CANCEL_NOT_ALLOWED',
            details: { reason: 'PAID_ONLINE' },
          },
        );
        expect(orderStatusService.transition).not.toHaveBeenCalled();
        expect(inventoryService.restock).not.toHaveBeenCalled();
      },
    );

    it.each(['CONFIRMED', 'PACKED', 'SHIPPING'] as const)(
      'đơn %s: 409 ORDER_CANCEL_NOT_ALLOWED / PROCESSING_STARTED',
      async (status) => {
        tx.order.findFirst.mockResolvedValue(loaded(status, 'COD'));

        await expectAppException(
          service.reject('shop-1', 'seller-1', 'o1', 'x'),
          {
            status: 409,
            code: 'ORDER_CANCEL_NOT_ALLOWED',
            details: { reason: 'PROCESSING_STARTED' },
          },
        );
      },
    );

    it.each(['AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED'] as const)(
      'đơn %s: 409 ORDER_INVALID_TRANSITION',
      async (status) => {
        tx.order.findFirst.mockResolvedValue(loaded(status, 'COD'));

        await expectAppException(
          service.reject('shop-1', 'seller-1', 'o1', 'x'),
          { status: 409, code: 'ORDER_INVALID_TRANSITION' },
        );
      },
    );

    it('thua race — KHÔNG hoàn kho (đơn không bị hủy bởi yêu cầu này)', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('PENDING', 'COD'));
      orderStatusService.transition.mockResolvedValue([]);

      await expectAppException(
        service.reject('shop-1', 'seller-1', 'o1', 'Hết hàng'),
        { status: 409, code: 'ORDER_ALREADY_CHANGED' },
      );
      expect(inventoryService.restock).not.toHaveBeenCalled();
    });
  });

  describe('cancelByBuyer', () => {
    it('đơn của người khác / không tồn tại — 404, không làm gì', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expectAppException(service.cancelByBuyer('buyer-1', 'o-khac'), {
        status: 404,
        code: 'ORDER_NOT_FOUND',
      });
      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'o-khac', userId: 'buyer-1' } }),
      );
    });

    it('đơn chưa thanh toán — hủy CẢ NHÓM qua PaymentService, không chuyển lẻ từng đơn', async () => {
      prisma.order.findFirst.mockResolvedValue({
        status: 'AWAITING_PAYMENT',
        checkoutGroupId: 'g1',
      });

      await service.cancelByBuyer('buyer-1', 'o1', 'Đổi ý');

      expect(paymentService.cancelCheckoutGroup).toHaveBeenCalledWith(
        'buyer-1',
        'g1',
        'Đổi ý',
      );
      expect(orderStatusService.transition).not.toHaveBeenCalled();
    });

    it('đơn COD chờ xác nhận — hủy đơn đó, actor BUYER, note mặc định, hoàn kho', async () => {
      prisma.order.findFirst.mockResolvedValue({
        status: 'PENDING',
        checkoutGroupId: 'g1',
      });
      tx.order.findFirst.mockResolvedValue(loaded('PENDING', 'COD'));

      await service.cancelByBuyer('buyer-1', 'o1');

      expect(tx.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'o1', userId: 'buyer-1' } }),
      );
      expect(orderStatusService.transition).toHaveBeenCalledWith(
        tx,
        ['o1'],
        'PENDING',
        'CANCELLED',
        BUYER,
        'Cancelled by buyer',
      );
      expect(inventoryService.restock).toHaveBeenCalledTimes(1);
      expect(paymentService.cancelCheckoutGroup).not.toHaveBeenCalled();
    });

    it('đơn đã trả online — 409 ORDER_CANCEL_NOT_ALLOWED / PAID_ONLINE (hoàn tiền: Tuần 9)', async () => {
      prisma.order.findFirst.mockResolvedValue({
        status: 'PENDING',
        checkoutGroupId: 'g1',
      });
      tx.order.findFirst.mockResolvedValue(loaded('PENDING', 'VNPAY'));

      await expectAppException(service.cancelByBuyer('buyer-1', 'o1'), {
        status: 409,
        code: 'ORDER_CANCEL_NOT_ALLOWED',
        details: { reason: 'PAID_ONLINE' },
      });
      expect(orderStatusService.transition).not.toHaveBeenCalled();
    });

    it('shop đã xác nhận — 409 ORDER_CANCEL_NOT_ALLOWED / PROCESSING_STARTED', async () => {
      prisma.order.findFirst.mockResolvedValue({
        status: 'CONFIRMED',
        checkoutGroupId: 'g1',
      });
      tx.order.findFirst.mockResolvedValue(loaded('CONFIRMED', 'COD'));

      await expectAppException(service.cancelByBuyer('buyer-1', 'o1'), {
        status: 409,
        code: 'ORDER_CANCEL_NOT_ALLOWED',
        details: { reason: 'PROCESSING_STARTED' },
      });
    });

    it('race với seller xác nhận (đọc còn PENDING, lúc cập nhật đã CONFIRMED) — 409 ORDER_ALREADY_CHANGED, không hoàn kho', async () => {
      prisma.order.findFirst.mockResolvedValue({
        status: 'PENDING',
        checkoutGroupId: 'g1',
      });
      tx.order.findFirst.mockResolvedValue(loaded('PENDING', 'COD'));
      orderStatusService.transition.mockResolvedValue([]);

      await expectAppException(service.cancelByBuyer('buyer-1', 'o1'), {
        status: 409,
        code: 'ORDER_ALREADY_CHANGED',
      });
      expect(inventoryService.restock).not.toHaveBeenCalled();
    });
  });

  describe('autoCompleteShipped — hệ thống tự hoàn tất đơn buyer không xác nhận (Week8.md 1.7)', () => {
    it('đơn trả online: SHIPPING → COMPLETED bởi SYSTEM, ghi chú nêu số ngày, đọc đơn KHÔNG ràng buộc userId, trả true', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('SHIPPING', 'VNPAY'));

      const result = await service.autoCompleteShipped('o1', 7);

      expect(result).toBe(true);
      expect(tx.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'o1' } }),
      );
      expect(orderStatusService.transition).toHaveBeenCalledWith(
        tx,
        ['o1'],
        'SHIPPING',
        'COMPLETED',
        { type: 'SYSTEM' },
        'Auto-completed: not confirmed by buyer within 7 day(s) of shipping',
      );
      expect(tx.payment.updateMany).not.toHaveBeenCalled();
    });

    it('đơn COD: dùng CHUNG đường hoàn tất — khoá nhóm trước khi chuyển rồi thu tiền khi cả nhóm đã xong', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('SHIPPING', 'COD'));
      tx.order.findMany.mockResolvedValue([{ status: 'COMPLETED' }]);

      await service.autoCompleteShipped('o1', 7);

      expect(calls).toEqual(['lockGroup', 'transition']);
      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { checkoutGroupId: 'g1', method: 'COD', status: 'PENDING' },
        data: { status: 'SUCCESS', paidAt: expect.any(Date) as Date },
      });
    });

    it.each([
      ['đơn không còn SHIPPING (buyer vừa bấm tay)', 'COMPLETED'],
      ['đơn bị đổi sang trạng thái khác', 'CANCELLED'],
    ] as const)(
      '%s — trả false (bình thường, không lỗi), không chuyển',
      async (_label, status) => {
        tx.order.findFirst.mockResolvedValue(loaded(status, 'VNPAY'));

        await expect(service.autoCompleteShipped('o1', 7)).resolves.toBe(false);
        expect(orderStatusService.transition).not.toHaveBeenCalled();
      },
    );

    it('thua race với buyer bấm tay (đọc còn SHIPPING nhưng lúc cập nhật đã đổi) — trả false', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('SHIPPING', 'VNPAY'));
      orderStatusService.transition.mockResolvedValue([]);

      await expect(service.autoCompleteShipped('o1', 7)).resolves.toBe(false);
      expect(tx.payment.updateMany).not.toHaveBeenCalled();
    });

    it('đơn không còn tồn tại — trả false', async () => {
      tx.order.findFirst.mockResolvedValue(null);

      await expect(service.autoCompleteShipped('o-ma', 7)).resolves.toBe(false);
    });

    it('lỗi THẬT (không phải 3 mã bình thường) — ném lên để job log', async () => {
      tx.order.findFirst.mockRejectedValue(new Error('db timeout'));

      await expect(service.autoCompleteShipped('o1', 7)).rejects.toThrow(
        'db timeout',
      );
    });

    it('KHÔNG gửi email nào (buyer không cần được báo việc hệ thống tự hoàn tất)', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('SHIPPING', 'VNPAY'));

      await service.autoCompleteShipped('o1', 7);

      expect(orderEmailService.notifyConfirmed).not.toHaveBeenCalled();
      expect(orderEmailService.notifyShipped).not.toHaveBeenCalled();
      expect(orderEmailService.notifyCancelled).not.toHaveBeenCalled();
    });
  });

  describe('confirmReceived', () => {
    it('đơn trả online: SHIPPING → COMPLETED bởi buyer, KHÔNG khoá nhóm, KHÔNG đụng Payment', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('SHIPPING', 'VNPAY'));

      await service.confirmReceived('buyer-1', 'o1');

      expect(orderStatusService.transition).toHaveBeenCalledWith(
        tx,
        ['o1'],
        'SHIPPING',
        'COMPLETED',
        BUYER,
        'Received by buyer',
      );
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.payment.updateMany).not.toHaveBeenCalled();
    });

    it.each(['AWAITING_PAYMENT', 'PENDING', 'PACKED', 'COMPLETED'] as const)(
      'đơn %s chưa ở trạng thái đang giao — 409 ORDER_INVALID_TRANSITION',
      async (status) => {
        tx.order.findFirst.mockResolvedValue(loaded(status));

        await expectAppException(service.confirmReceived('buyer-1', 'o1'), {
          status: 409,
          code: 'ORDER_INVALID_TRANSITION',
        });
        expect(orderStatusService.transition).not.toHaveBeenCalled();
      },
    );

    it('đơn của người khác — 404 (phạm vi theo userId)', async () => {
      tx.order.findFirst.mockResolvedValue(null);

      await expectAppException(service.confirmReceived('buyer-1', 'o-khac'), {
        status: 404,
        code: 'ORDER_NOT_FOUND',
      });
      expect(tx.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'o-khac', userId: 'buyer-1' } }),
      );
    });

    it('thua race — 409 ORDER_ALREADY_CHANGED', async () => {
      tx.order.findFirst.mockResolvedValue(loaded('SHIPPING', 'VNPAY'));
      orderStatusService.transition.mockResolvedValue([]);

      await expectAppException(service.confirmReceived('buyer-1', 'o1'), {
        status: 409,
        code: 'ORDER_ALREADY_CHANGED',
      });
    });

    describe('COD — thu tiền khi cả nhóm đã đi tới đích', () => {
      it('khoá TOÀN BỘ đơn của nhóm TRƯỚC khi chuyển trạng thái', async () => {
        tx.order.findFirst.mockResolvedValue(loaded('SHIPPING', 'COD'));
        tx.order.findMany.mockResolvedValue([{ status: 'COMPLETED' }]);

        await service.confirmReceived('buyer-1', 'o1');

        expect(calls).toEqual(['lockGroup', 'transition']);
      });

      it('mọi đơn đã COMPLETED — Payment COD PENDING → SUCCESS kèm paidAt', async () => {
        tx.order.findFirst.mockResolvedValue(loaded('SHIPPING', 'COD'));
        tx.order.findMany.mockResolvedValue([
          { status: 'COMPLETED' },
          { status: 'COMPLETED' },
        ]);

        await service.confirmReceived('buyer-1', 'o1');

        expect(tx.payment.updateMany).toHaveBeenCalledWith({
          where: { checkoutGroupId: 'g1', method: 'COD', status: 'PENDING' },
          data: { status: 'SUCCESS', paidAt: expect.any(Date) as Date },
        });
      });

      it('đơn bị hủy trong nhóm không cản việc thu tiền (miễn có ≥ 1 đơn COMPLETED)', async () => {
        tx.order.findFirst.mockResolvedValue(loaded('SHIPPING', 'COD'));
        tx.order.findMany.mockResolvedValue([
          { status: 'COMPLETED' },
          { status: 'CANCELLED' },
        ]);

        await service.confirmReceived('buyer-1', 'o1');

        expect(tx.payment.updateMany).toHaveBeenCalledTimes(1);
      });

      it('còn đơn đang giao/chờ — CHƯA thu tiền', async () => {
        tx.order.findFirst.mockResolvedValue(loaded('SHIPPING', 'COD'));
        tx.order.findMany.mockResolvedValue([
          { status: 'COMPLETED' },
          { status: 'SHIPPING' },
        ]);

        await service.confirmReceived('buyer-1', 'o1');

        expect(tx.payment.updateMany).not.toHaveBeenCalled();
      });

      it('thua race — không thu tiền', async () => {
        tx.order.findFirst.mockResolvedValue(loaded('SHIPPING', 'COD'));
        orderStatusService.transition.mockResolvedValue([]);

        await expectAppException(service.confirmReceived('buyer-1', 'o1'), {
          status: 409,
          code: 'ORDER_ALREADY_CHANGED',
        });
        expect(tx.payment.updateMany).not.toHaveBeenCalled();
      });
    });
  });
});
