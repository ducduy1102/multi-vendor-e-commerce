import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateRefundRequestInput } from '@ecommerce/types';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { RefundRequestActionService } from './refund-request-action.service';
import type { RefundRequestService } from './refund-request.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const BUYER = { type: 'BUYER', id: 'buyer-1' };

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
  };
  let refundRequestService: { transition: jest.Mock; recordCreated: jest.Mock };

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
    };
    refundRequestService = {
      transition: jest.fn().mockResolvedValue(undefined),
      recordCreated: jest.fn().mockResolvedValue(undefined),
    };
    service = new RefundRequestActionService(
      prisma as unknown as PrismaService,
      refundRequestService as unknown as RefundRequestService,
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
});
