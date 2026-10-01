import { Injectable } from '@nestjs/common';
import type { OrderActorType, OrderStatus } from '@prisma/client';
import type { TxClient } from '../../shared/prisma/tx-client';
import { isValidOrderTransition } from './checkout-group-status';

// Người thực hiện 1 lần chuyển trạng thái. SYSTEM (job, callback cổng thanh toán) không có id.
export type OrderActor =
  { type: 'SYSTEM' } | { type: Exclude<OrderActorType, 'SYSTEM'>; id: string };

// Cạnh chuyển không có trong ORDER_STATUS_TRANSITIONS — lỗi lập trình của nơi gọi (luật "ai được
// làm cạnh nào" kiểm ở service nghiệp vụ TRƯỚC khi tới đây), không phải lỗi người dùng.
export class InvalidOrderTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`Invalid order status transition: ${from} -> ${to}`);
    this.name = 'InvalidOrderTransitionError';
  }
}

// Điểm DUY NHẤT đổi Order.status (Week8.md 1.3): kiểm cạnh hợp lệ, cập nhật có điều kiện
// (`WHERE status = <cũ>` — cũng là ổ khoá idempotent) và ghi OrderStatusHistory trong CÙNG
// transaction của người gọi. Không tự mở $transaction, nhận `tx` đầu tiên — cùng quy ước với
// InventoryService/VoucherUsageService (Week7.md 1.14). Không nơi nào khác được
// `tx.order.update({ data: { status } })`, nếu không timeline sẽ thủng.
@Injectable()
export class OrderStatusService {
  // Trả id các đơn THẬT SỰ lật được (đang đúng `from`), sắp tăng dần; đơn đã sang trạng thái khác
  // (vd đơn thua cuộc trong 1 race) bị bỏ qua êm — người gọi so với độ dài danh sách để biết thắng/thua.
  //
  // Khoá hàng theo `id` tăng dần ngay trong câu UPDATE (subquery `ORDER BY id FOR UPDATE`) để 2
  // transaction cùng đổi 1 tập đơn không deadlock, kể cả khi người gọi chưa tự khoá (thứ tự khoá
  // chung: đơn → variant → voucher, note-inventory-payment-expiry_week7.md mục 20).
  async transition(
    tx: TxClient,
    orderIds: string[],
    from: OrderStatus,
    to: OrderStatus,
    actor: OrderActor,
    note?: string,
  ): Promise<string[]> {
    if (!isValidOrderTransition(from, to)) {
      throw new InvalidOrderTransitionError(from, to);
    }
    const ids = [...new Set(orderIds)].sort();
    if (ids.length === 0) return [];

    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE orders
      SET status = ${to}::"OrderStatus",
          updated_at = now() AT TIME ZONE 'UTC'
      WHERE id IN (
        SELECT id FROM orders
        WHERE id = ANY(${ids}::text[]) AND status = ${from}::"OrderStatus"
        ORDER BY id
        FOR UPDATE
      )
      RETURNING id`;
    const flipped = rows.map((r) => r.id).sort();
    if (flipped.length === 0) return [];

    // Giờ thật của lần chuyển (không dùng default now() của DB = giờ BẮT ĐẦU transaction, có thể
    // sớm hơn lúc chuyển thật khi phải chờ khoá, làm timeline sai thứ tự).
    const now = new Date();
    await tx.orderStatusHistory.createMany({
      data: flipped.map((orderId) => ({
        orderId,
        fromStatus: from,
        toStatus: to,
        actorType: actor.type,
        actorId: actor.type === 'SYSTEM' ? null : actor.id,
        note: note ?? null,
        createdAt: now,
      })),
    });
    return flipped;
  }

  // Mốc tạo đơn (fromStatus = null) — gọi ngay sau khi tạo đơn, trong cùng transaction.
  async recordCreated(
    tx: TxClient,
    orders: { id: string; status: OrderStatus }[],
    actor: OrderActor,
  ): Promise<void> {
    if (orders.length === 0) return;
    const now = new Date();
    await tx.orderStatusHistory.createMany({
      data: orders.map((order) => ({
        orderId: order.id,
        fromStatus: null,
        toStatus: order.status,
        actorType: actor.type,
        actorId: actor.type === 'SYSTEM' ? null : actor.id,
        createdAt: now,
      })),
    });
  }
}
