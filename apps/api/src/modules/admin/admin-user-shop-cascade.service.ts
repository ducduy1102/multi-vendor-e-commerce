import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SHOP_CASCADE_SUSPEND_REASON } from '@ecommerce/types';
import type { TxClient } from '../../shared/prisma/tx-client';
import { ShopStatusService } from '../shop/shop-status.service';

// Khoá / mở lại SHOP theo tài khoản chủ shop (Week11.md 3.4, D2). Chạy TRONG transaction của AdminUserStatusService, không
// tự mở transaction (cùng quy ước ShopStatusService / OrderStatusService: nhận `tx` đầu tiên). Mọi lần đổi trạng thái shop đi
// qua `ShopStatusService.transition` với actor SYSTEM nên vẫn có ShopStatusHistory và statusReason/statusChangedAt đúng.
//
// Cả hai đường đọc danh sách shop bằng `SELECT ... FOR UPDATE`: khoá hàng shop để (1) không có Admin nào khác đổi trạng thái
// các shop đó giữa lúc ta đọc và lúc ta ghi (nên `transition` không thể ném 409 làm hỏng việc khoá tài khoản), (2) điều kiện
// `status = ...` được Postgres kiểm lại SAU khi chờ khoá nên shop vừa bị đổi sẽ bị loại khỏi tập.
@Injectable()
export class AdminUserShopCascadeService {
  constructor(private readonly shopStatusService: ShopStatusService) {}

  // Tài khoản bị khoá / cấm ⇒ mọi shop APPROVED của chủ tài khoản thành SUSPENDED. Shop PENDING / REJECTED / SUSPENDED giữ
  // nguyên (PENDING còn bị chặn duyệt ở AdminService nhờ SHOP_OWNER_NOT_ACTIVE). Trả số shop đã khoá.
  async suspendOwnedShops(tx: TxClient, ownerId: string): Promise<number> {
    const shops = await this.lockOwnedShops(tx, ownerId, 'APPROVED');

    for (const shop of shops) {
      await this.shopStatusService.transition(
        tx,
        shop.id,
        'APPROVED',
        'SUSPENDED',
        { type: 'SYSTEM' },
        SHOP_CASCADE_SUSPEND_REASON,
      );
    }
    return shops.length;
  }

  // Tài khoản được mở lại từ TẠM KHOÁ ⇒ chỉ mở lại shop do CHÍNH lần khoá này khoá: shop đang SUSPENDED mà dòng lịch sử MỚI
  // NHẤT là dòng cascade (SYSTEM, → SUSPENDED, ghi chú SHOP_CASCADE_SUSPEND_REASON) VÀ được ghi không trước lúc tài khoản vào
  // trạng thái khoá hiện tại (`lockStartedAt` = `User.statusChangedAt` trước khi mở lại). Điều kiện thứ hai chặn ca: tạm khoá
  // (shop A bị cascade) → nâng lên cấm → mở lại từ cấm (A KHÔNG tự mở) → tạm khoá lần nữa (A đã SUSPENDED nên không có dòng
  // cascade mới) → mở lại: nếu chỉ xét "dòng mới nhất là cascade" thì A bị mở lại nhờ dòng của lần khoá CŨ, trái luật
  // "cấm thì phải xét lại thủ công". Shop Admin tự khoá (dòng mới nhất là ADMIN), hoặc bị khoá vì lý do khác, không bị đụng.
  // `lockStartedAt` null (dữ liệu dựng tay, không có mốc) ⇒ chỉ xét dòng mới nhất. Trả số shop đã mở lại.
  async reopenCascadeSuspendedShops(
    tx: TxClient,
    ownerId: string,
    lockStartedAt: Date | null,
  ): Promise<number> {
    const locked = await this.lockOwnedShops(tx, ownerId, 'SUSPENDED');
    if (locked.length === 0) return 0;

    const candidates = await tx.shop.findMany({
      where: { id: { in: locked.map((shop) => shop.id) } },
      select: {
        id: true,
        statusHistory: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            actorType: true,
            toStatus: true,
            note: true,
            createdAt: true,
          },
        },
      },
    });

    const eligible = candidates.filter(({ statusHistory }) => {
      const latest = statusHistory[0];
      return (
        latest !== undefined &&
        latest.actorType === 'SYSTEM' &&
        latest.toStatus === 'SUSPENDED' &&
        latest.note === SHOP_CASCADE_SUSPEND_REASON &&
        (lockStartedAt === null || latest.createdAt >= lockStartedAt)
      );
    });

    for (const shop of eligible) {
      await this.shopStatusService.transition(
        tx,
        shop.id,
        'SUSPENDED',
        'APPROVED',
        { type: 'SYSTEM' },
      );
    }
    return eligible.length;
  }

  // Số shop của chủ tài khoản đang SUSPENDED — dùng khi mở lại từ BỊ CẤM (shop không tự mở) để email báo trước.
  async countSuspendedShops(tx: TxClient, ownerId: string): Promise<number> {
    return tx.shop.count({ where: { ownerId, status: 'SUSPENDED' } });
  }

  private lockOwnedShops(
    tx: TxClient,
    ownerId: string,
    status: 'APPROVED' | 'SUSPENDED',
  ): Promise<{ id: string }[]> {
    // `status` là hằng của hai nơi gọi (không bao giờ từ input) nhưng vẫn là tham số ràng buộc có ép kiểu enum. ORDER BY id để
    // hai transaction khoá cùng tập shop luôn khoá theo cùng thứ tự (tránh deadlock).
    return tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM shops WHERE owner_id = ${ownerId} AND status = ${status}::"ShopStatus" ORDER BY id FOR UPDATE`,
    );
  }
}
