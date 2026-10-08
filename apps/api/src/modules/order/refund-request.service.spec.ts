import type { RefundRequestKind, RefundRequestStatus } from '@prisma/client';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import type { TxClient } from '../../shared/prisma/tx-client';
import type { OrderActor } from './order-status.service';
import { RefundRequestService } from './refund-request.service';

const SELLER: OrderActor = { type: 'SELLER', id: 'seller-1' };
const BUYER: OrderActor = { type: 'BUYER', id: 'buyer-1' };
const ADMIN: OrderActor = { type: 'ADMIN', id: 'admin-1' };
const SYSTEM: OrderActor = { type: 'SYSTEM' };

describe('RefundRequestService.transition', () => {
  let service: RefundRequestService;
  let tx: {
    refundRequest: { findUnique: jest.Mock; updateMany: jest.Mock };
    refundRequestHistory: { create: jest.Mock };
  };

  beforeEach(() => {
    service = new RefundRequestService();
    tx = {
      refundRequest: {
        findUnique: jest.fn().mockResolvedValue({ kind: 'CANCEL' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refundRequestHistory: { create: jest.fn().mockResolvedValue({}) },
    };
  });

  const run = (
    from: RefundRequestStatus,
    to: RefundRequestStatus,
    actor: OrderActor,
    note?: string | null,
    kind: RefundRequestKind = 'CANCEL',
  ) => {
    tx.refundRequest.findUnique.mockResolvedValue({ kind });
    return service.transition(
      tx as unknown as TxClient,
      'r1',
      from,
      to,
      actor,
      note,
    );
  };

  describe('đường thành công', () => {
    it('cập nhật CÓ ĐIỀU KIỆN theo trạng thái cũ và ghi đúng MỘT dòng history cùng giờ với statusChangedAt', async () => {
      await run('PENDING_SELLER', 'APPROVED', SELLER);

      expect(tx.refundRequest.updateMany).toHaveBeenCalledTimes(1);
      const update = (
        tx.refundRequest.updateMany.mock.calls[0] as [
          { where: unknown; data: { status: string; statusChangedAt: Date } },
        ]
      )[0];
      expect(update.where).toEqual({ id: 'r1', status: 'PENDING_SELLER' });
      expect(update.data.status).toBe('APPROVED');

      expect(tx.refundRequestHistory.create).toHaveBeenCalledTimes(1);
      const history = (
        tx.refundRequestHistory.create.mock.calls[0] as [
          {
            data: Record<string, unknown>;
          },
        ]
      )[0];
      expect(history.data).toEqual({
        refundRequestId: 'r1',
        fromStatus: 'PENDING_SELLER',
        toStatus: 'APPROVED',
        actorType: 'SELLER',
        actorId: 'seller-1',
        note: null,
        createdAt: update.data.statusChangedAt,
      });
    });

    it('actor SYSTEM không có id', async () => {
      await run('PENDING_SELLER', 'APPROVED', SYSTEM, undefined, 'CANCEL');

      const history = (
        tx.refundRequestHistory.create.mock.calls[0] as [
          { data: { actorType: string; actorId: string | null } },
        ]
      )[0];
      expect(history.data.actorType).toBe('SYSTEM');
      expect(history.data.actorId).toBeNull();
    });

    it.each([undefined, null, '', '   '])(
      'ghi chú %p ⇒ note là null, KHÔNG BAO GIỜ là chuỗi mặc định',
      async (note) => {
        await run('PENDING_SELLER', 'APPROVED', ADMIN, note);

        const history = (
          tx.refundRequestHistory.create.mock.calls[0] as [
            { data: { note: string | null } },
          ]
        )[0];
        expect(history.data.note).toBeNull();
      },
    );

    it('ghi chú của người quyết định được trim và giữ nguyên văn', async () => {
      await run(
        'PENDING_SELLER',
        'REJECTED_BY_SELLER',
        SELLER,
        '  Hàng đã đóng gói rồi  ',
      );

      const history = (
        tx.refundRequestHistory.create.mock.calls[0] as [
          { data: { note: string | null } },
        ]
      )[0];
      expect(history.data.note).toBe('Hàng đã đóng gói rồi');
    });
  });

  describe('bảng chuyển có ACTOR — cạnh sai bị chặn và KHÔNG chạm DB', () => {
    const FORBIDDEN: [
      string,
      RefundRequestStatus,
      RefundRequestStatus,
      OrderActor,
      RefundRequestKind,
    ][] = [
      ['buyer tự duyệt yêu cầu', 'PENDING_SELLER', 'APPROVED', BUYER, 'CANCEL'],
      [
        'seller tự đưa lên ESCALATED',
        'PENDING_SELLER',
        'ESCALATED',
        SELLER,
        'RETURN',
      ],
      [
        'seller khiếu nại hộ buyer',
        'REJECTED_BY_SELLER',
        'ESCALATED',
        SELLER,
        'RETURN',
      ],
      ['Admin rút hộ buyer', 'PENDING_SELLER', 'WITHDRAWN', ADMIN, 'CANCEL'],
      [
        'hệ thống tự duyệt TRẢ HÀNG (chỉ được chuyển Admin)',
        'PENDING_SELLER',
        'APPROVED',
        SYSTEM,
        'RETURN',
      ],
      [
        'hệ thống chuyển Admin yêu cầu HỦY (chỉ được tự duyệt)',
        'PENDING_SELLER',
        'ESCALATED',
        SYSTEM,
        'CANCEL',
      ],
      [
        'seller nhượng bộ yêu cầu TRẢ HÀNG đã lên sàn (chỉ Admin quyết)',
        'ESCALATED',
        'APPROVED',
        SELLER,
        'RETURN',
      ],
      ['từ trạng thái cuối', 'APPROVED', 'REJECTED', ADMIN, 'CANCEL'],
    ];

    it.each(FORBIDDEN)('%s ⇒ 409', async (_name, from, to, actor, kind) => {
      await expectAppException(run(from, to, actor, 'ghi chú', kind), {
        status: 409,
        code: 'REFUND_REQUEST_INVALID_TRANSITION',
      });

      expect(tx.refundRequest.updateMany).not.toHaveBeenCalled();
      expect(tx.refundRequestHistory.create).not.toHaveBeenCalled();
    });

    it('seller "nhượng bộ" (tự hủy đơn) đóng được yêu cầu HỦY đã lên sàn', async () => {
      await run('ESCALATED', 'APPROVED', SELLER, null, 'CANCEL');

      expect(tx.refundRequestHistory.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('thua race / không tồn tại', () => {
    it('0 dòng lật được (đã có người xử lý trước) ⇒ 409 và KHÔNG ghi history', async () => {
      tx.refundRequest.updateMany.mockResolvedValue({ count: 0 });

      await expectAppException(run('PENDING_SELLER', 'APPROVED', SELLER), {
        status: 409,
        code: 'REFUND_REQUEST_INVALID_TRANSITION',
      });

      expect(tx.refundRequestHistory.create).not.toHaveBeenCalled();
    });

    it('yêu cầu không tồn tại ⇒ 404 REFUND_REQUEST_NOT_FOUND', async () => {
      tx.refundRequest.findUnique.mockResolvedValue(null);

      await expectAppException(
        service.transition(
          tx as unknown as TxClient,
          'missing',
          'PENDING_SELLER',
          'APPROVED',
          SELLER,
        ),
        { status: 404, code: 'REFUND_REQUEST_NOT_FOUND' },
      );
      expect(tx.refundRequest.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('đích bắt buộc có lý do', () => {
    it.each([
      ['PENDING_SELLER', 'REJECTED_BY_SELLER', SELLER],
      ['PENDING_SELLER', 'REJECTED', ADMIN],
      ['ESCALATED', 'REJECTED', ADMIN],
    ] as const)(
      '%s → %s thiếu ghi chú ⇒ lỗi lập trình, KHÔNG ghi gì',
      async (from, to, actor) => {
        await expect(run(from, to, actor, '  ')).rejects.toThrow(
          `A note is required to move a refund request to ${to}`,
        );

        expect(tx.refundRequest.updateMany).not.toHaveBeenCalled();
        expect(tx.refundRequestHistory.create).not.toHaveBeenCalled();
      },
    );

    it('duyệt / rút / khiếu nại không cần ghi chú', async () => {
      await run('PENDING_SELLER', 'WITHDRAWN', BUYER);
      await run('REJECTED_BY_SELLER', 'ESCALATED', BUYER);

      expect(tx.refundRequestHistory.create).toHaveBeenCalledTimes(2);
    });
  });
});
