import { Injectable } from '@nestjs/common';
import type { ShopActorType, ShopStatus } from '@prisma/client';
import {
  ADMIN_SHOP_STATUSES_REQUIRING_REASON,
  canActorTransitionShop,
} from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import type { TxClient } from '../../shared/prisma/tx-client';

// Người thực hiện 1 lần chuyển trạng thái shop. SYSTEM (backfill, hệ thống) không có id.
export type ShopActor =
  { type: 'SYSTEM' } | { type: Exclude<ShopActorType, 'SYSTEM'>; id: string };

// Trạng thái đích mang LÝ DO (do người nhập, hiển thị được cho seller): từ chối và khoá. Các trạng thái
// đích còn lại (duyệt, mở khoá, nộp lại) luôn xoá lý do.
const REASON_STATUSES: readonly string[] = ADMIN_SHOP_STATUSES_REQUIRING_REASON;

// Điểm DUY NHẤT đổi Shop.status (Week8.md 3C.1, cùng tinh thần OrderStatusService): trong CÙNG
// transaction của người gọi — kiểm cạnh + actor, cập nhật có điều kiện (`WHERE status = <cũ>`, cũng là ổ
// khoá idempotent), ghi ShopStatusHistory, cập nhật statusReason + statusChangedAt. Không tự mở
// $transaction, nhận `tx` đầu tiên (cùng quy ước OrderStatusService/InventoryService). Không nơi nào
// khác được `shop.update({ data: { status } })`, nếu không history/statusChangedAt sẽ thủng.
@Injectable()
export class ShopStatusService {
  // Ném 409 SHOP_INVALID_TRANSITION khi cạnh/actor không có trong SHOP_STATUS_TRANSITIONS HOẶC shop
  // không còn ở `from` (đã có người khác xử lý / thua race / không tồn tại) — gộp làm 1 vì với người
  // dùng cả hai đều nghĩa là dữ liệu đang xem đã cũ. Người gọi tự kiểm quyền sở hữu/tồn tại TRƯỚC khi tới
  // đây (Admin: 404 nếu không có shop; chủ shop: ShopOwnerGuard).
  async transition(
    tx: TxClient,
    shopId: string,
    from: ShopStatus,
    to: ShopStatus,
    actor: ShopActor,
    reason?: string | null,
  ): Promise<void> {
    if (!canActorTransitionShop(actor.type, from, to)) {
      throw this.invalidTransition(from, to);
    }

    const carriesReason = REASON_STATUSES.includes(to);
    if (carriesReason && !reason?.trim()) {
      // Lỗi lập trình của nơi gọi (DTO đã bắt buộc lý do ở mức validate), không phải lỗi người dùng.
      throw new Error(`A reason is required to move a shop to ${to}`);
    }
    // Lý do gửi kèm khi duyệt/mở khoá/nộp lại bị bỏ qua, không phải lỗi.
    const statusReason = carriesReason ? (reason ?? null) : null;

    // Giờ thật của lần chuyển — dùng chung cho statusChangedAt và history.createdAt để cột phi chuẩn
    // statusChangedAt luôn bằng đúng mốc history mới nhất.
    const now = new Date();
    const { count } = await tx.shop.updateMany({
      where: { id: shopId, status: from },
      data: { status: to, statusReason, statusChangedAt: now },
    });
    if (count === 0) {
      throw this.invalidTransition(from, to);
    }

    await tx.shopStatusHistory.create({
      data: {
        shopId,
        fromStatus: from,
        toStatus: to,
        actorType: actor.type,
        actorId: actor.type === 'SYSTEM' ? null : actor.id,
        note: statusReason,
        createdAt: now,
      },
    });
  }

  // Mốc tạo shop (fromStatus = null) — gọi ngay sau khi tạo shop, trong cùng transaction. createdAt lấy
  // đúng `shop.createdAt` (cũng là mốc mặc định của statusChangedAt: 2 cột cùng DEFAULT now() nên bằng
  // nhau trong 1 transaction).
  async recordCreated(
    tx: TxClient,
    shop: { id: string; status: ShopStatus; createdAt: Date },
    actor: ShopActor,
  ): Promise<void> {
    await tx.shopStatusHistory.create({
      data: {
        shopId: shop.id,
        fromStatus: null,
        toStatus: shop.status,
        actorType: actor.type,
        actorId: actor.type === 'SYSTEM' ? null : actor.id,
        note: null,
        createdAt: shop.createdAt,
      },
    });
  }

  private invalidTransition(from: ShopStatus, to: ShopStatus): AppException {
    return new AppException(
      409,
      'SHOP_INVALID_TRANSITION',
      `Cannot change shop status from ${from} to ${to}`,
    );
  }
}
