import { Injectable } from '@nestjs/common';
import type { RefundRequestStatus } from '@prisma/client';
import { canActorTransitionRefundRequest } from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import type { TxClient } from '../../shared/prisma/tx-client';
import type { OrderActor } from './order-status.service';

// Trạng thái đích MANG LÝ DO của người ra quyết định (seller/Admin từ chối): người mua phải đọc được vì sao.
// Các đích còn lại (duyệt, rút, khiếu nại, chuyển Admin) có thể không có ghi chú.
const NOTE_REQUIRED_STATUSES: readonly RefundRequestStatus[] = [
  'REJECTED_BY_SELLER',
  'REJECTED',
];

// Điểm DUY NHẤT đổi RefundRequest.status (Week9.md 1.4, cùng mẫu ShopStatusService/OrderStatusService): trong
// CÙNG transaction của người gọi — kiểm cạnh + actor theo REFUND_REQUEST_TRANSITIONS, cập nhật có điều kiện
// (`WHERE status = <cũ>`, cũng là ổ khoá idempotent), cập nhật statusChangedAt và ghi RefundRequestHistory.
// Không tự mở $transaction, nhận `tx` đầu tiên (cùng quy ước OrderStatusService/InventoryService). Không nơi
// nào khác được `refundRequest.update({ data: { status } })`, nếu không timeline sẽ thủng.
@Injectable()
export class RefundRequestService {
  // `note` là lý do của NGƯỜI RA QUYẾT ĐỊNH; không có thì để null — KHÔNG chèn chuỗi mặc định (người kia đọc
  // nguyên văn, bài học Tuần 8: chuỗi mặc định hiện sai thành "lý do").
  //
  // Ném 409 REFUND_REQUEST_INVALID_TRANSITION khi cạnh/actor không có trong bảng HOẶC yêu cầu không còn ở
  // `from` (đã có người xử lý trước / thua race) — gộp làm 1 vì với người dùng cả hai đều nghĩa là dữ liệu
  // đang xem đã cũ. Người gọi tự kiểm quyền xem/sở hữu yêu cầu TRƯỚC khi tới đây.
  async transition(
    tx: TxClient,
    requestId: string,
    from: RefundRequestStatus,
    to: RefundRequestStatus,
    actor: OrderActor,
    note?: string | null,
  ): Promise<void> {
    // `kind` bất biến sau khi tạo nên đọc không khoá vẫn đúng; cần để luật "hệ thống chỉ hủy→tự duyệt,
    // trả hàng→chuyển Admin" và "seller chỉ nhượng bộ ở kind CANCEL" áp đúng.
    const request = await tx.refundRequest.findUnique({
      where: { id: requestId },
      select: { kind: true },
    });
    if (!request) {
      throw new AppException(
        404,
        'REFUND_REQUEST_NOT_FOUND',
        'Refund request not found',
      );
    }
    if (!canActorTransitionRefundRequest(actor.type, request.kind, from, to)) {
      throw this.invalidTransition(from, to);
    }

    const decisionNote = note?.trim() || null;
    if (NOTE_REQUIRED_STATUSES.includes(to) && !decisionNote) {
      // Lỗi lập trình của nơi gọi (DTO đã bắt buộc ghi chú ở mức validate), không phải lỗi người dùng.
      throw new Error(`A note is required to move a refund request to ${to}`);
    }

    // Giờ thật của lần chuyển — dùng chung cho statusChangedAt và history.createdAt để cột phi chuẩn luôn
    // bằng đúng mốc của dòng history mới nhất.
    const now = new Date();
    const { count } = await tx.refundRequest.updateMany({
      where: { id: requestId, status: from },
      data: { status: to, statusChangedAt: now },
    });
    if (count === 0) {
      throw this.invalidTransition(from, to);
    }

    await tx.refundRequestHistory.create({
      data: {
        refundRequestId: requestId,
        fromStatus: from,
        toStatus: to,
        actorType: actor.type,
        actorId: actor.type === 'SYSTEM' ? null : actor.id,
        note: decisionNote,
        createdAt: now,
      },
    });
  }

  private invalidTransition(
    from: RefundRequestStatus,
    to: RefundRequestStatus,
  ): AppException {
    return new AppException(
      409,
      'REFUND_REQUEST_INVALID_TRANSITION',
      `Cannot change refund request status from ${from} to ${to}`,
    );
  }
}
