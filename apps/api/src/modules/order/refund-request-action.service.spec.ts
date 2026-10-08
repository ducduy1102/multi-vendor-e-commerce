import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ORDER_STATUSES_VISIBLE_TO_SELLER,
  type CreateRefundRequestInput,
} from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { RefundRequestActionService } from './refund-request-action.service';
import type { RefundRequestService } from './refund-request.service';
import type { RefundService } from './refund.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const BUYER = { type: 'BUYER', id: 'buyer-1' };
const SELLER = { type: 'SELLER', id: 'seller-1' };

const input = (
  overrides: Partial<CreateRefundRequestInput> = {},
): CreateRefundRequestInput => ({
  reasonCode: 'CHANGE_OF_MIND',
  reasonNote: undefined,
  ...overrides,
});

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    shopId: 'shop-1',
    status: 'CONFIRMED',
    checkoutGroup: { payments: [{ method: 'VNPAY', status: 'SUCCESS' }] },
    statusHistory: [],
    refundRequests: [],
    ...overrides,
  };
}

describe('RefundRequestActionService', () => {
  let service: RefundRequestActionService;
  let tx: {
    $queryRaw: jest.Mock;
    refundRequest: { create: jest.Mock; findFirst: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    order: { findFirst: jest.Mock };
    refundRequest: { findFirst: jest.Mock; findUnique: jest.Mock };
  };
  let refundRequestService: { transition: jest.Mock; recordCreated: jest.Mock };
  let refundService: {
    cancelOrderWithRefund: jest.Mock;
    refundReturnedOrder: jest.Mock;
  };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'CONFIRMED' }]),
      refundRequest: {
        create: jest.fn().mockResolvedValue({
          id: 'req-1',
          createdAt: new Date('2026-10-08T10:00:00.000Z'),
        }),
        findFirst: jest.fn(),
      },
    };
    prisma = {
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      order: { findFirst: jest.fn().mockResolvedValue(orderRow()) },
      refundRequest: { findFirst: jest.fn(), findUnique: jest.fn() },
    };
    refundService = {
      cancelOrderWithRefund: jest.fn().mockResolvedValue({ refund: null }),
      refundReturnedOrder: jest.fn().mockResolvedValue({ refund: null }),
    };
    refundRequestService = {
      transition: jest.fn().mockResolvedValue(undefined),
      recordCreated: jest.fn().mockResolvedValue(undefined),
    };
    service = new RefundRequestActionService(
      prisma as unknown as PrismaService,
      refundRequestService as unknown as RefundRequestService,
      refundService as unknown as RefundService,
    );
  });

  afterEach(() => {
    delete process.env.REFUND_SELLER_RESPONSE_HOURS;
    delete process.env.REFUND_WINDOW_DAYS;
    delete process.env.REFUND_ESCALATE_DAYS;
  });

  describe('createForBuyer', () => {
    it('đọc đơn theo CẢ id lẫn userId; đơn của người khác / không tồn tại ⇒ 404, không ghi gì', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expectAppException(
        service.createForBuyer('buyer-1', 'o-khac', input()),
        { status: 404, code: 'ORDER_NOT_FOUND' },
      );
      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'o-khac', userId: 'buyer-1' } }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    describe('loại yêu cầu do BE suy từ trạng thái đơn', () => {
      it.each(['CONFIRMED', 'PACKED'] as const)(
        'đơn %s ⇒ yêu cầu HỦY (CANCEL), do chính người mua gửi, chờ seller',
        async (status) => {
          prisma.order.findFirst.mockResolvedValue(orderRow({ status }));
          tx.$queryRaw.mockResolvedValue([{ status }]);

          await service.createForBuyer(
            'buyer-1',
            'o1',
            input({ reasonCode: 'OTHER', reasonNote: 'Đặt trùng đơn' }),
          );

          expect(tx.refundRequest.create).toHaveBeenCalledWith({
            data: {
              orderId: 'o1',
              shopId: 'shop-1',
              userId: 'buyer-1',
              kind: 'CANCEL',
              reasonCode: 'OTHER',
              reasonNote: 'Đặt trùng đơn',
              sellerRespondBy: expect.any(Date) as Date,
            },
            select: { id: true, createdAt: true },
          });
        },
      );

      it('đơn COMPLETED trong cửa sổ ⇒ yêu cầu TRẢ HÀNG (RETURN)', async () => {
        prisma.order.findFirst.mockResolvedValue(
          orderRow({
            status: 'COMPLETED',
            statusHistory: [{ createdAt: new Date(Date.now() - 2 * DAY_MS) }],
          }),
        );
        tx.$queryRaw.mockResolvedValue([{ status: 'COMPLETED' }]);

        await service.createForBuyer(
          'buyer-1',
          'o1',
          input({ reasonCode: 'DAMAGED' }),
        );

        const create = tx.refundRequest.create.mock.calls[0] as [
          { data: { kind: string } },
        ];
        expect(create[0].data.kind).toBe('RETURN');
      });

      it.each([
        'AWAITING_PAYMENT',
        'PENDING',
        'SHIPPING',
        'CANCELLED',
        'REFUNDED',
      ] as const)(
        'đơn %s không có yêu cầu nào ⇒ 409 NOT_ELIGIBLE_STATUS (chờ xác nhận thì hủy ngay; đang giao không hủy được)',
        async (status) => {
          prisma.order.findFirst.mockResolvedValue(orderRow({ status }));

          await expectAppException(
            service.createForBuyer('buyer-1', 'o1', input()),
            {
              status: 409,
              code: 'REFUND_REQUEST_NOT_ALLOWED',
              details: { reason: 'NOT_ELIGIBLE_STATUS' },
            },
          );
          expect(prisma.$transaction).not.toHaveBeenCalled();
        },
      );
    });

    describe('lý do phải thuộc đúng loại yêu cầu', () => {
      it('lý do của yêu cầu TRẢ HÀNG (hàng lỗi) dùng cho yêu cầu HỦY ⇒ 400 theo field reasonCode, không ghi gì', async () => {
        const error = await service
          .createForBuyer('buyer-1', 'o1', input({ reasonCode: 'DAMAGED' }))
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toBe(
          'reasonCode: order.validationRefundReasonInvalid',
        );
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('lý do của yêu cầu HỦY (đổi ý) dùng cho yêu cầu TRẢ HÀNG ⇒ 400', async () => {
        prisma.order.findFirst.mockResolvedValue(
          orderRow({
            status: 'COMPLETED',
            statusHistory: [{ createdAt: new Date() }],
          }),
        );

        await expect(
          service.createForBuyer(
            'buyer-1',
            'o1',
            input({ reasonCode: 'CHANGE_OF_MIND' }),
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('OTHER dùng được ở cả hai loại', async () => {
        await service.createForBuyer(
          'buyer-1',
          'o1',
          input({ reasonCode: 'OTHER', reasonNote: 'x' }),
        );

        expect(tx.refundRequest.create).toHaveBeenCalledTimes(1);
      });
    });

    describe('cửa sổ trả hàng', () => {
      const completedOrder = (daysAgo: number | null) =>
        orderRow({
          status: 'COMPLETED',
          statusHistory:
            daysAgo === null
              ? []
              : [{ createdAt: new Date(Date.now() - daysAgo * DAY_MS) }],
        });
      const returnInput = input({ reasonCode: 'DAMAGED' });

      it('quá REFUND_WINDOW_DAYS (mặc định 7) ⇒ 409 WINDOW_EXPIRED', async () => {
        prisma.order.findFirst.mockResolvedValue(completedOrder(8));

        await expectAppException(
          service.createForBuyer('buyer-1', 'o1', returnInput),
          {
            status: 409,
            code: 'REFUND_REQUEST_NOT_ALLOWED',
            details: { reason: 'WINDOW_EXPIRED' },
          },
        );
      });

      it('đọc cấu hình LÚC DÙNG: nới REFUND_WINDOW_DAYS thì cùng đơn gửi được', async () => {
        prisma.order.findFirst.mockResolvedValue(completedOrder(8));
        process.env.REFUND_WINDOW_DAYS = '15';
        tx.$queryRaw.mockResolvedValue([{ status: 'COMPLETED' }]);

        await service.createForBuyer('buyer-1', 'o1', returnInput);

        expect(tx.refundRequest.create).toHaveBeenCalledTimes(1);
      });

      it('thiếu mốc COMPLETED trong lịch sử (không nên xảy ra) ⇒ khoá cho an toàn, WINDOW_EXPIRED', async () => {
        prisma.order.findFirst.mockResolvedValue(completedOrder(null));

        await expectAppException(
          service.createForBuyer('buyer-1', 'o1', returnInput),
          {
            status: 409,
            code: 'REFUND_REQUEST_NOT_ALLOWED',
            details: { reason: 'WINDOW_EXPIRED' },
          },
        );
      });
    });

    describe('mỗi đơn tối đa một yêu cầu mỗi loại', () => {
      it('đã có yêu cầu HỦY chưa rút ⇒ 409 ALREADY_REQUESTED', async () => {
        prisma.order.findFirst.mockResolvedValue(
          orderRow({ refundRequests: [{ kind: 'CANCEL' }] }),
        );

        await expectAppException(
          service.createForBuyer('buyer-1', 'o1', input()),
          {
            status: 409,
            code: 'REFUND_REQUEST_NOT_ALLOWED',
            details: { reason: 'ALREADY_REQUESTED' },
          },
        );
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('chỉ có yêu cầu TRẢ HÀNG khác loại ⇒ không chặn yêu cầu hủy', async () => {
        prisma.order.findFirst.mockResolvedValue(
          orderRow({ refundRequests: [{ kind: 'RETURN' }] }),
        );

        await service.createForBuyer('buyer-1', 'o1', input());

        expect(tx.refundRequest.create).toHaveBeenCalledTimes(1);
      });

      it('hai lần gửi lọt qua bước kiểm cùng lúc: index duy nhất (P2002) bị bắt NGOÀI transaction và báo ALREADY_REQUESTED', async () => {
        prisma.$transaction.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('unique', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        );

        await expectAppException(
          service.createForBuyer('buyer-1', 'o1', input()),
          {
            status: 409,
            code: 'REFUND_REQUEST_NOT_ALLOWED',
            details: { reason: 'ALREADY_REQUESTED' },
          },
        );
      });

      it('lỗi DB khác được giữ nguyên, không bị nuốt thành ALREADY_REQUESTED', async () => {
        prisma.$transaction.mockRejectedValue(new Error('connection lost'));

        await expect(
          service.createForBuyer('buyer-1', 'o1', input()),
        ).rejects.toThrow('connection lost');
      });
    });

    describe('thanh toán đã thu', () => {
      it('đơn online chưa có thanh toán thành công ⇒ 409 PAYMENT_NOT_COLLECTED', async () => {
        prisma.order.findFirst.mockResolvedValue(
          orderRow({
            checkoutGroup: {
              payments: [{ method: 'VNPAY', status: 'FAILED' }],
            },
          }),
        );

        await expectAppException(
          service.createForBuyer('buyer-1', 'o1', input()),
          {
            status: 409,
            code: 'REFUND_REQUEST_NOT_ALLOWED',
            details: { reason: 'PAYMENT_NOT_COLLECTED' },
          },
        );
      });

      it('đơn COD chưa thu tiền vẫn xin hủy được (không có tiền để hoàn)', async () => {
        prisma.order.findFirst.mockResolvedValue(
          orderRow({
            checkoutGroup: {
              payments: [{ method: 'COD', status: 'PENDING' }],
            },
          }),
        );

        await service.createForBuyer('buyer-1', 'o1', input());

        expect(tx.refundRequest.create).toHaveBeenCalledTimes(1);
      });
    });

    describe('ghi yêu cầu', () => {
      it('hạn seller phản hồi = bây giờ + REFUND_SELLER_RESPONSE_HOURS (mặc định 48h), đọc cấu hình lúc dùng', async () => {
        const before = Date.now();
        await service.createForBuyer('buyer-1', 'o1', input());
        process.env.REFUND_SELLER_RESPONSE_HOURS = '12';
        await service.createForBuyer('buyer-1', 'o1', input());
        const after = Date.now();

        const respondBy = (
          tx.refundRequest.create.mock.calls as [
            { data: { sellerRespondBy: Date } },
          ][]
        ).map(([arg]) => arg.data.sellerRespondBy.getTime());
        const HOUR = 60 * 60 * 1000;
        expect(respondBy[0]).toBeGreaterThanOrEqual(before + 48 * HOUR);
        expect(respondBy[0]).toBeLessThanOrEqual(after + 48 * HOUR);
        expect(respondBy[1]).toBeGreaterThanOrEqual(before + 12 * HOUR);
        expect(respondBy[1]).toBeLessThanOrEqual(after + 12 * HOUR);
      });

      it('không có ghi chú ⇒ reasonNote lưu null', async () => {
        await service.createForBuyer('buyer-1', 'o1', input());

        const create = tx.refundRequest.create.mock.calls[0] as [
          { data: { reasonNote: string | null } },
        ];
        expect(create[0].data.reasonNote).toBeNull();
      });

      it('ghi mốc tạo trong CÙNG transaction, actor là người mua', async () => {
        await service.createForBuyer('buyer-1', 'o1', input());

        expect(refundRequestService.recordCreated).toHaveBeenCalledWith(
          tx,
          { id: 'req-1', createdAt: new Date('2026-10-08T10:00:00.000Z') },
          BUYER,
        );
      });

      it('khoá hàng đơn (FOR UPDATE) trước khi tạo để tuần tự hoá với seller đóng gói/giao/hủy', async () => {
        await service.createForBuyer('buyer-1', 'o1', input());

        const sql = (
          tx.$queryRaw.mock.calls[0] as [TemplateStringsArray]
        )[0].join('?');
        expect(sql).toContain('FROM orders WHERE id = ?');
        expect(sql).toContain('FOR UPDATE');
      });

      it('đơn đã đổi trạng thái giữa lúc đọc và lúc khoá (seller vừa giao) ⇒ 409 ORDER_ALREADY_CHANGED, KHÔNG để lại yêu cầu mồ côi', async () => {
        tx.$queryRaw.mockResolvedValue([{ status: 'SHIPPING' }]);

        await expectAppException(
          service.createForBuyer('buyer-1', 'o1', input()),
          { status: 409, code: 'ORDER_ALREADY_CHANGED' },
        );
        expect(tx.refundRequest.create).not.toHaveBeenCalled();
        expect(refundRequestService.recordCreated).not.toHaveBeenCalled();
      });
    });
  });

  describe('withdrawForBuyer', () => {
    it('đọc yêu cầu theo CẢ id lẫn userId; chuyển từ trạng thái hiện tại → WITHDRAWN bởi người mua; trả orderId', async () => {
      tx.refundRequest.findFirst.mockResolvedValue({
        orderId: 'o1',
        status: 'PENDING_SELLER',
        statusChangedAt: new Date(),
      });

      const result = await service.withdrawForBuyer('buyer-1', 'req-1');

      expect(tx.refundRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'req-1', userId: 'buyer-1' } }),
      );
      expect(refundRequestService.transition).toHaveBeenCalledWith(
        tx,
        'req-1',
        'PENDING_SELLER',
        'WITHDRAWN',
        BUYER,
      );
      expect(result).toEqual({ orderId: 'o1' });
    });

    it('yêu cầu của người khác / không tồn tại ⇒ 404 REFUND_REQUEST_NOT_FOUND', async () => {
      tx.refundRequest.findFirst.mockResolvedValue(null);

      await expectAppException(service.withdrawForBuyer('buyer-1', 'req-x'), {
        status: 404,
        code: 'REFUND_REQUEST_NOT_FOUND',
      });
      expect(refundRequestService.transition).not.toHaveBeenCalled();
    });

    it('bảng chuyển từ chối (seller đã trả lời) ⇒ lỗi 409 của RefundRequestService được giữ nguyên', async () => {
      tx.refundRequest.findFirst.mockResolvedValue({
        orderId: 'o1',
        status: 'REJECTED_BY_SELLER',
        statusChangedAt: new Date(),
      });
      refundRequestService.transition.mockRejectedValue(
        Object.assign(new Error('x'), {
          code: 'REFUND_REQUEST_INVALID_TRANSITION',
        }),
      );

      await expect(
        service.withdrawForBuyer('buyer-1', 'req-1'),
      ).rejects.toMatchObject({ code: 'REFUND_REQUEST_INVALID_TRANSITION' });
    });
  });

  describe('escalateForBuyer', () => {
    const rejected = (daysAgo: number) => ({
      orderId: 'o1',
      status: 'REJECTED_BY_SELLER',
      statusChangedAt: new Date(Date.now() - daysAgo * DAY_MS),
    });

    it('seller đã từ chối, còn trong hạn ⇒ REJECTED_BY_SELLER → ESCALATED bởi người mua', async () => {
      tx.refundRequest.findFirst.mockResolvedValue(rejected(1));

      const result = await service.escalateForBuyer('buyer-1', 'req-1');

      expect(refundRequestService.transition).toHaveBeenCalledWith(
        tx,
        'req-1',
        'REJECTED_BY_SELLER',
        'ESCALATED',
        BUYER,
      );
      expect(result).toEqual({ orderId: 'o1' });
    });

    it('quá REFUND_ESCALATE_DAYS (mặc định 3) kể từ lúc bị từ chối ⇒ 409 WINDOW_EXPIRED, không chuyển', async () => {
      tx.refundRequest.findFirst.mockResolvedValue(rejected(4));

      await expectAppException(service.escalateForBuyer('buyer-1', 'req-1'), {
        status: 409,
        code: 'REFUND_REQUEST_NOT_ALLOWED',
        details: { reason: 'WINDOW_EXPIRED' },
      });
      expect(refundRequestService.transition).not.toHaveBeenCalled();
    });

    it('đọc cấu hình LÚC DÙNG: REFUND_ESCALATE_DAYS lớn hơn thì cùng yêu cầu vẫn khiếu nại được', async () => {
      tx.refundRequest.findFirst.mockResolvedValue(rejected(4));
      process.env.REFUND_ESCALATE_DAYS = '7';

      await service.escalateForBuyer('buyer-1', 'req-1');

      expect(refundRequestService.transition).toHaveBeenCalledTimes(1);
    });

    it('yêu cầu CHƯA bị từ chối (còn chờ seller) ⇒ không kiểm hạn mà để bảng chuyển từ chối với từ trạng thái hiện tại', async () => {
      tx.refundRequest.findFirst.mockResolvedValue({
        orderId: 'o1',
        status: 'PENDING_SELLER',
        statusChangedAt: new Date(Date.now() - 30 * DAY_MS),
      });

      await service.escalateForBuyer('buyer-1', 'req-1');

      expect(refundRequestService.transition).toHaveBeenCalledWith(
        tx,
        'req-1',
        'PENDING_SELLER',
        'ESCALATED',
        BUYER,
      );
    });

    it('yêu cầu của người khác / không tồn tại ⇒ 404', async () => {
      tx.refundRequest.findFirst.mockResolvedValue(null);

      await expectAppException(service.escalateForBuyer('buyer-1', 'req-x'), {
        status: 404,
        code: 'REFUND_REQUEST_NOT_FOUND',
      });
    });
  });

  // --- Seller (Week9.md 2.7) --------------------------------------------------------------------
  describe('seller', () => {
    const sellerRequest = (overrides: Record<string, unknown> = {}) => ({
      id: 'req-1',
      kind: 'CANCEL',
      status: 'PENDING_SELLER',
      orderId: 'o1',
      ...overrides,
    });

    describe('approveForSeller', () => {
      it('đọc yêu cầu theo CẢ id, shop, không phải yêu cầu đã rút và đơn Seller được thấy (predicate dùng chung)', async () => {
        prisma.refundRequest.findFirst.mockResolvedValue(sellerRequest());

        await service.approveForSeller('shop-1', 'seller-1', 'req-1');

        expect(prisma.refundRequest.findFirst).toHaveBeenCalledWith({
          where: {
            id: 'req-1',
            shopId: 'shop-1',
            status: { not: 'WITHDRAWN' },
            order: {
              status: { in: [...ORDER_STATUSES_VISIBLE_TO_SELLER] },
              statusHistory: { some: { toStatus: 'PENDING' } },
            },
          },
          select: { id: true, kind: true, status: true, orderId: true },
        });
      });

      it('yêu cầu của shop khác / đơn bị ẩn / đã rút / không tồn tại ⇒ 404, không hủy gì', async () => {
        prisma.refundRequest.findFirst.mockResolvedValue(null);

        await expectAppException(
          service.approveForSeller('shop-1', 'seller-1', 'req-x'),
          { status: 404, code: 'REFUND_REQUEST_NOT_FOUND' },
        );
        expect(refundService.cancelOrderWithRefund).not.toHaveBeenCalled();
        expect(refundService.refundReturnedOrder).not.toHaveBeenCalled();
      });

      it('yêu cầu HỦY ⇒ hủy đơn qua RefundService, đóng ĐÚNG yêu cầu này (fail-closed), chỉ nhận đơn CONFIRMED/PACKED, kèm ghi chú duyệt', async () => {
        prisma.refundRequest.findFirst.mockResolvedValue(sellerRequest());

        await service.approveForSeller(
          'shop-1',
          'seller-1',
          'req-1',
          'Đồng ý hủy',
        );

        expect(refundService.cancelOrderWithRefund).toHaveBeenCalledWith(
          SELLER,
          'o1',
          {
            reason: 'Đồng ý hủy',
            refundRequestId: 'req-1',
            onlyFrom: ['CONFIRMED', 'PACKED'],
          },
        );
        expect(refundService.refundReturnedOrder).not.toHaveBeenCalled();
      });

      it('yêu cầu HỦY đã lên sàn (ESCALATED) vẫn duyệt được — seller nhượng bộ', async () => {
        prisma.refundRequest.findFirst.mockResolvedValue(
          sellerRequest({ status: 'ESCALATED' }),
        );

        await service.approveForSeller('shop-1', 'seller-1', 'req-1');

        expect(refundService.cancelOrderWithRefund).toHaveBeenCalledTimes(1);
      });

      it('yêu cầu TRẢ HÀNG ⇒ COMPLETED → REFUNDED qua RefundService, đóng đúng yêu cầu này', async () => {
        prisma.refundRequest.findFirst.mockResolvedValue(
          sellerRequest({ kind: 'RETURN' }),
        );

        await service.approveForSeller('shop-1', 'seller-1', 'req-1', null);

        expect(refundService.refundReturnedOrder).toHaveBeenCalledWith(
          SELLER,
          'o1',
          { reason: null, refundRequestId: 'req-1' },
        );
        expect(refundService.cancelOrderWithRefund).not.toHaveBeenCalled();
      });

      it('yêu cầu TRẢ HÀNG đã lên sàn ⇒ 409 (Admin quyết định), không đụng tới đơn', async () => {
        prisma.refundRequest.findFirst.mockResolvedValue(
          sellerRequest({ kind: 'RETURN', status: 'ESCALATED' }),
        );

        await expectAppException(
          service.approveForSeller('shop-1', 'seller-1', 'req-1'),
          { status: 409, code: 'REFUND_REQUEST_INVALID_TRANSITION' },
        );
        expect(refundService.refundReturnedOrder).not.toHaveBeenCalled();
      });

      it.each(['APPROVED', 'REJECTED_BY_SELLER', 'REJECTED'] as const)(
        'yêu cầu đã %s ⇒ 409 REFUND_REQUEST_INVALID_TRANSITION ngay từ đầu, không lật đơn rồi mới rollback',
        async (status) => {
          prisma.refundRequest.findFirst.mockResolvedValue(
            sellerRequest({ status }),
          );

          await expectAppException(
            service.approveForSeller('shop-1', 'seller-1', 'req-1'),
            { status: 409, code: 'REFUND_REQUEST_INVALID_TRANSITION' },
          );
          expect(refundService.cancelOrderWithRefund).not.toHaveBeenCalled();
        },
      );

      it('lỗi của RefundService (người mua vừa rút, đơn vừa đổi...) được giữ nguyên', async () => {
        prisma.refundRequest.findFirst.mockResolvedValue(sellerRequest());
        refundService.cancelOrderWithRefund.mockRejectedValue(
          Object.assign(new Error('x'), {
            code: 'REFUND_REQUEST_INVALID_TRANSITION',
          }),
        );

        await expect(
          service.approveForSeller('shop-1', 'seller-1', 'req-1'),
        ).rejects.toMatchObject({ code: 'REFUND_REQUEST_INVALID_TRANSITION' });
      });
    });

    describe('rejectForSeller', () => {
      it('chuyển từ trạng thái hiện tại → REJECTED_BY_SELLER bởi seller, ghi chú vào lịch sử, KHÔNG đụng tới đơn', async () => {
        tx.refundRequest.findFirst.mockResolvedValue(sellerRequest());

        await service.rejectForSeller(
          'shop-1',
          'seller-1',
          'req-1',
          'Hàng đã giao vận chuyển',
        );

        expect(refundRequestService.transition).toHaveBeenCalledWith(
          tx,
          'req-1',
          'PENDING_SELLER',
          'REJECTED_BY_SELLER',
          SELLER,
          'Hàng đã giao vận chuyển',
        );
        expect(refundService.cancelOrderWithRefund).not.toHaveBeenCalled();
        expect(refundService.refundReturnedOrder).not.toHaveBeenCalled();
      });

      it('đọc yêu cầu TRONG transaction với cùng phạm vi shop + predicate đơn Seller được thấy', async () => {
        tx.refundRequest.findFirst.mockResolvedValue(sellerRequest());

        await service.rejectForSeller('shop-1', 'seller-1', 'req-1', 'x');

        expect(tx.refundRequest.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: 'req-1',
              shopId: 'shop-1',
              status: { not: 'WITHDRAWN' },
            }) as object,
          }),
        );
      });

      it('yêu cầu của shop khác / không tồn tại ⇒ 404, không chuyển', async () => {
        tx.refundRequest.findFirst.mockResolvedValue(null);

        await expectAppException(
          service.rejectForSeller('shop-1', 'seller-1', 'req-x', 'x'),
          { status: 404, code: 'REFUND_REQUEST_NOT_FOUND' },
        );
        expect(refundRequestService.transition).not.toHaveBeenCalled();
      });

      it('bảng chuyển từ chối (đã xử lý / đã lên sàn) ⇒ lỗi 409 của RefundRequestService được giữ nguyên', async () => {
        tx.refundRequest.findFirst.mockResolvedValue(
          sellerRequest({ status: 'ESCALATED' }),
        );
        refundRequestService.transition.mockRejectedValue(
          Object.assign(new Error('x'), {
            code: 'REFUND_REQUEST_INVALID_TRANSITION',
          }),
        );

        await expect(
          service.rejectForSeller('shop-1', 'seller-1', 'req-1', 'x'),
        ).rejects.toMatchObject({ code: 'REFUND_REQUEST_INVALID_TRANSITION' });
      });
    });
  });

  // --- Admin (Week9.md 2.9) -------------------------------------------------------------------------
  describe('decideForAdmin', () => {
    const ADMIN = { type: 'ADMIN', id: 'admin-1' };
    const adminRequest = (overrides: Record<string, unknown> = {}) => ({
      id: 'req-1',
      kind: 'CANCEL',
      status: 'ESCALATED',
      orderId: 'o1',
      ...overrides,
    });

    it('đọc yêu cầu CHỈ theo id (Admin không bị giới hạn theo shop như seller)', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(adminRequest());

      await service.decideForAdmin('admin-1', 'req-1', 'APPROVE');

      expect(prisma.refundRequest.findUnique).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        select: { id: true, kind: true, status: true, orderId: true },
      });
    });

    it('yêu cầu không tồn tại ⇒ 404, không ghi gì', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(null);

      await expectAppException(
        service.decideForAdmin('admin-1', 'req-x', 'APPROVE'),
        { status: 404, code: 'REFUND_REQUEST_NOT_FOUND' },
      );
      expect(refundService.cancelOrderWithRefund).not.toHaveBeenCalled();
      expect(refundRequestService.transition).not.toHaveBeenCalled();
    });

    describe('APPROVE', () => {
      it.each(['ESCALATED', 'PENDING_SELLER'] as const)(
        'yêu cầu HỦY đang %s ⇒ hủy đơn qua RefundService bởi ADMIN, đóng ĐÚNG yêu cầu này (fail-closed), chỉ nhận đơn CONFIRMED/PACKED, kèm ghi chú',
        async (status) => {
          prisma.refundRequest.findUnique.mockResolvedValue(
            adminRequest({ status }),
          );

          await service.decideForAdmin(
            'admin-1',
            'req-1',
            'APPROVE',
            'Đồng ý hủy',
          );

          expect(refundService.cancelOrderWithRefund).toHaveBeenCalledWith(
            ADMIN,
            'o1',
            {
              reason: 'Đồng ý hủy',
              refundRequestId: 'req-1',
              onlyFrom: ['CONFIRMED', 'PACKED'],
            },
          );
          expect(refundService.refundReturnedOrder).not.toHaveBeenCalled();
          expect(refundRequestService.transition).not.toHaveBeenCalled();
        },
      );

      it.each(['ESCALATED', 'PENDING_SELLER'] as const)(
        'yêu cầu TRẢ HÀNG đang %s ⇒ COMPLETED → REFUNDED qua RefundService, không ghi chú thì null',
        async (status) => {
          prisma.refundRequest.findUnique.mockResolvedValue(
            adminRequest({ kind: 'RETURN', status }),
          );

          await service.decideForAdmin('admin-1', 'req-1', 'APPROVE');

          expect(refundService.refundReturnedOrder).toHaveBeenCalledWith(
            ADMIN,
            'o1',
            { reason: undefined, refundRequestId: 'req-1' },
          );
          expect(refundService.cancelOrderWithRefund).not.toHaveBeenCalled();
        },
      );

      it('lỗi của RefundService (người mua vừa rút, đơn vừa đổi...) được giữ nguyên', async () => {
        prisma.refundRequest.findUnique.mockResolvedValue(adminRequest());
        refundService.cancelOrderWithRefund.mockRejectedValue(
          Object.assign(new Error('x'), {
            code: 'REFUND_REQUEST_INVALID_TRANSITION',
          }),
        );

        await expect(
          service.decideForAdmin('admin-1', 'req-1', 'APPROVE'),
        ).rejects.toMatchObject({ code: 'REFUND_REQUEST_INVALID_TRANSITION' });
      });
    });

    describe('REJECT', () => {
      it.each(['ESCALATED', 'PENDING_SELLER'] as const)(
        'yêu cầu đang %s ⇒ chuyển → REJECTED bởi ADMIN trong một transaction, ghi chú vào lịch sử, KHÔNG đụng tới đơn',
        async (status) => {
          prisma.refundRequest.findUnique.mockResolvedValue(
            adminRequest({ status }),
          );

          await service.decideForAdmin(
            'admin-1',
            'req-1',
            'REJECT',
            'Không đủ bằng chứng',
          );

          expect(refundRequestService.transition).toHaveBeenCalledWith(
            tx,
            'req-1',
            status,
            'REJECTED',
            ADMIN,
            'Không đủ bằng chứng',
          );
          expect(refundService.cancelOrderWithRefund).not.toHaveBeenCalled();
          expect(refundService.refundReturnedOrder).not.toHaveBeenCalled();
        },
      );

      it('lỗi 409 của RefundRequestService (thua race) được giữ nguyên', async () => {
        prisma.refundRequest.findUnique.mockResolvedValue(adminRequest());
        refundRequestService.transition.mockRejectedValue(
          Object.assign(new Error('x'), {
            code: 'REFUND_REQUEST_INVALID_TRANSITION',
          }),
        );

        await expect(
          service.decideForAdmin('admin-1', 'req-1', 'REJECT', 'x'),
        ).rejects.toMatchObject({ code: 'REFUND_REQUEST_INVALID_TRANSITION' });
      });
    });

    // Bảng chuyển có actor ADMIN là nguồn duy nhất: ngoài PENDING_SELLER / ESCALATED, Admin không quyết định được.
    it.each([
      'REJECTED_BY_SELLER',
      'APPROVED',
      'REJECTED',
      'WITHDRAWN',
    ] as const)(
      'yêu cầu đã %s ⇒ 409 REFUND_REQUEST_INVALID_TRANSITION ngay từ đầu (cả duyệt lẫn từ chối), không hủy đơn rồi mới rollback',
      async (status) => {
        prisma.refundRequest.findUnique.mockResolvedValue(
          adminRequest({ status }),
        );

        for (const decision of ['APPROVE', 'REJECT'] as const) {
          await expectAppException(
            service.decideForAdmin('admin-1', 'req-1', decision, 'x'),
            { status: 409, code: 'REFUND_REQUEST_INVALID_TRANSITION' },
          );
        }
        expect(refundService.cancelOrderWithRefund).not.toHaveBeenCalled();
        expect(refundService.refundReturnedOrder).not.toHaveBeenCalled();
        expect(refundRequestService.transition).not.toHaveBeenCalled();
      },
    );
  });

  // --- Hệ thống: RefundJob (Week9.md 2.8) -----------------------------------------------------------
  describe('resolveOverdueRequest', () => {
    const SYSTEM = { type: 'SYSTEM' };
    const NOW = new Date('2026-10-10T12:00:00.000Z');
    const overdueRequest = (overrides: Record<string, unknown> = {}) => ({
      id: 'req-1',
      kind: 'CANCEL',
      status: 'PENDING_SELLER',
      orderId: 'o1',
      sellerRespondBy: new Date('2026-10-10T11:59:59.000Z'),
      ...overrides,
    });
    const raceError = (code: string) =>
      new AppException(
        409,
        code as 'REFUND_REQUEST_INVALID_TRANSITION',
        'race',
      );

    it('yêu cầu HỦY quá hạn ⇒ tự duyệt bằng actor SYSTEM, đóng ĐÚNG yêu cầu này (fail-closed), chỉ đơn CONFIRMED/PACKED, không ghi chú', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(overdueRequest());

      await expect(service.resolveOverdueRequest('req-1', NOW)).resolves.toBe(
        'APPROVED',
      );

      expect(refundService.cancelOrderWithRefund).toHaveBeenCalledWith(
        SYSTEM,
        'o1',
        { refundRequestId: 'req-1', onlyFrom: ['CONFIRMED', 'PACKED'] },
      );
      expect(refundRequestService.transition).not.toHaveBeenCalled();
    });

    it('yêu cầu TRẢ HÀNG quá hạn ⇒ chuyển Admin (ESCALATED) bằng actor SYSTEM, KHÔNG duyệt, không đụng tới đơn', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(
        overdueRequest({ kind: 'RETURN' }),
      );

      await expect(service.resolveOverdueRequest('req-1', NOW)).resolves.toBe(
        'ESCALATED',
      );

      expect(refundRequestService.transition).toHaveBeenCalledWith(
        tx,
        'req-1',
        'PENDING_SELLER',
        'ESCALATED',
        SYSTEM,
      );
      expect(refundService.cancelOrderWithRefund).not.toHaveBeenCalled();
      expect(refundService.refundReturnedOrder).not.toHaveBeenCalled();
    });

    it('đọc yêu cầu theo id (kiểm lại trạng thái + hạn lúc xử lý, không tin danh sách ứng viên đã cũ)', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(overdueRequest());

      await service.resolveOverdueRequest('req-1', NOW);

      expect(prisma.refundRequest.findUnique).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        select: {
          id: true,
          kind: true,
          status: true,
          orderId: true,
          sellerRespondBy: true,
        },
      });
    });

    it.each(['REJECTED_BY_SELLER', 'ESCALATED', 'APPROVED', 'WITHDRAWN'])(
      'yêu cầu đã sang %s (không còn chờ seller) ⇒ null, không làm gì',
      async (status) => {
        prisma.refundRequest.findUnique.mockResolvedValue(
          overdueRequest({ status }),
        );

        await expect(
          service.resolveOverdueRequest('req-1', NOW),
        ).resolves.toBeNull();
        expect(refundService.cancelOrderWithRefund).not.toHaveBeenCalled();
        expect(refundRequestService.transition).not.toHaveBeenCalled();
      },
    );

    it('chưa quá hạn (hạn đúng bằng "bây giờ" vẫn chưa tính là quá) ⇒ null, không làm gì', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(
        overdueRequest({ sellerRespondBy: NOW }),
      );

      await expect(
        service.resolveOverdueRequest('req-1', NOW),
      ).resolves.toBeNull();
      expect(refundService.cancelOrderWithRefund).not.toHaveBeenCalled();
    });

    it('yêu cầu không tồn tại ⇒ null', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveOverdueRequest('req-x', NOW),
      ).resolves.toBeNull();
    });

    it.each(['REFUND_REQUEST_INVALID_TRANSITION', 'ORDER_ALREADY_CHANGED'])(
      'HỦY: thua race (%s — seller/buyer/Admin xử lý trước) ⇒ null, không ném',
      async (code) => {
        prisma.refundRequest.findUnique.mockResolvedValue(overdueRequest());
        refundService.cancelOrderWithRefund.mockRejectedValue(raceError(code));

        await expect(
          service.resolveOverdueRequest('req-1', NOW),
        ).resolves.toBeNull();
      },
    );

    it('TRẢ HÀNG: seller/Admin xử lý trước (bảng chuyển từ chối) ⇒ null, không ném', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(
        overdueRequest({ kind: 'RETURN' }),
      );
      refundRequestService.transition.mockRejectedValue(
        raceError('REFUND_REQUEST_INVALID_TRANSITION'),
      );

      await expect(
        service.resolveOverdueRequest('req-1', NOW),
      ).resolves.toBeNull();
    });

    it('lỗi KHÔNG phải thua race (đơn ở trạng thái không hủy được, DB lỗi) vẫn được ném để job log', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(overdueRequest());
      refundService.cancelOrderWithRefund.mockRejectedValue(
        raceError('ORDER_INVALID_TRANSITION'),
      );

      await expect(
        service.resolveOverdueRequest('req-1', NOW),
      ).rejects.toMatchObject({ code: 'ORDER_INVALID_TRANSITION' });

      refundService.cancelOrderWithRefund.mockRejectedValue(new Error('db'));
      await expect(service.resolveOverdueRequest('req-1', NOW)).rejects.toThrow(
        'db',
      );
    });

    it('mặc định dùng giờ hiện tại khi không truyền mốc', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(
        overdueRequest({ sellerRespondBy: new Date(Date.now() - 1000) }),
      );

      await expect(service.resolveOverdueRequest('req-1')).resolves.toBe(
        'APPROVED',
      );
    });
  });
});
