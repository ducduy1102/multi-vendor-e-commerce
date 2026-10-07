import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TxClient } from '../../shared/prisma/tx-client';

export interface InventoryLine {
  productVariantId: string;
  quantity: number;
}

export interface StockShortage {
  productVariantId: string;
  requested: number;
  // Số còn đặt được lúc kiểm (0 nếu variant đã ẩn/không tồn tại).
  available: number;
}

// Ném khi ít nhất 1 variant không đủ hàng để giữ chỗ. Là lỗi thường (không phải HttpException)
// vì module product không biết mã lỗi của checkout: CheckoutService bắt lại và đổi thành
// 409 OUT_OF_STOCK kèm tên sản phẩm. Ném ra khỏi callback của $transaction thì toàn bộ
// giữ chỗ vừa làm được rollback.
export class InsufficientStockError extends Error {
  constructor(readonly shortages: StockShortage[]) {
    super(
      `Insufficient stock for ${shortages.map((s) => s.productVariantId).join(', ')}`,
    );
    this.name = 'InsufficientStockError';
  }
}

// Ném khi commit/release gặp variant không còn đủ số đang giữ chỗ — nghĩa là bất biến kho đã
// vỡ (lỗi lập trình/dữ liệu), không phải tình huống nghiệp vụ. Ném để transaction rollback
// thay vì im lặng làm kho sai thêm.
export class InventoryInvariantError extends Error {
  constructor(operation: string, productVariantId: string) {
    super(
      `Inventory invariant violated on ${operation} for ${productVariantId}`,
    );
    this.name = 'InventoryInvariantError';
  }
}

// Nơi DUY NHẤT chứa SQL `reserved_stock` (Week7.md 1.3/1.14).
//
// Quy ước chung:
// - Mọi hàm nhận `tx` đầu tiên và KHÔNG tự mở $transaction lồng — người điều phối
//   (CheckoutService/PaymentService) mở transaction rồi truyền xuống, để thứ tự khoá nằm ở
//   1 chỗ đọc được.
// - Mọi hàm gộp dòng trùng variant và duyệt theo `id` TĂNG DẦN: 2 transaction cùng chạm 1
//   tập variant theo thứ tự khác nhau sẽ deadlock.
// - Mỗi thay đổi là 1 câu UPDATE có điều kiện (không đọc-rồi-ghi); CHECK ở DB là lưới cuối.
@Injectable()
export class InventoryService {
  // Giữ chỗ hàng cho đơn chưa thanh toán. Trả giá HIỆN TẠI của từng variant, đọc ngay trong
  // câu UPDATE đang cầm khoá dòng — Seller không đổi giá được cho tới khi transaction kết
  // thúc nên `priceAtPurchase` là giá thật lúc chốt (Week7.md 1.11 (2)).
  //
  // Không dừng ở variant thiếu đầu tiên: duyệt hết rồi ném MỘT lỗi chứa đủ danh sách để người
  // mua thấy mọi món hết hàng trong 1 lần.
  async reserve(
    tx: TxClient,
    lines: InventoryLine[],
  ): Promise<Map<string, Prisma.Decimal>> {
    const prices = new Map<string, Prisma.Decimal>();
    const failed: { productVariantId: string; requested: number }[] = [];

    for (const { productVariantId, quantity } of normalizeLines(lines)) {
      const rows = await tx.$queryRaw<{ id: string; price: Prisma.Decimal }[]>`
        UPDATE product_variants
        SET reserved_stock = reserved_stock + ${quantity},
            updated_at = now() AT TIME ZONE 'UTC'
        WHERE id = ${productVariantId}
          AND is_active
          AND stock - reserved_stock >= ${quantity}
        RETURNING id, price`;
      if (rows.length === 1) {
        prices.set(productVariantId, rows[0].price);
      } else {
        failed.push({ productVariantId, requested: quantity });
      }
    }

    if (failed.length > 0) {
      throw new InsufficientStockError(
        await this.describeShortages(tx, failed),
      );
    }
    return prices;
  }

  // Thanh toán thành công: kho vật lý giảm và giữ chỗ được giải phóng cùng lúc nên
  // `available` không đổi.
  async commit(tx: TxClient, lines: InventoryLine[]): Promise<void> {
    for (const { productVariantId, quantity } of normalizeLines(lines)) {
      const affected = await tx.$executeRaw`
        UPDATE product_variants
        SET stock = stock - ${quantity},
            reserved_stock = reserved_stock - ${quantity},
            updated_at = now() AT TIME ZONE 'UTC'
        WHERE id = ${productVariantId}
          AND reserved_stock >= ${quantity}
          AND stock >= ${quantity}`;
      if (affected !== 1) {
        throw new InventoryInvariantError('commit', productVariantId);
      }
    }
  }

  // Thanh toán thất bại/hết hạn: chỉ nhả giữ chỗ, kho vật lý chưa từng bị trừ.
  async release(tx: TxClient, lines: InventoryLine[]): Promise<void> {
    for (const { productVariantId, quantity } of normalizeLines(lines)) {
      const affected = await tx.$executeRaw`
        UPDATE product_variants
        SET reserved_stock = reserved_stock - ${quantity},
            updated_at = now() AT TIME ZONE 'UTC'
        WHERE id = ${productVariantId}
          AND reserved_stock >= ${quantity}`;
      if (affected !== 1) {
        throw new InventoryInvariantError('release', productVariantId);
      }
    }
  }

  // Đơn ĐÃ chốt kho (commit) bị hủy trước khi giao (Week8.md 2.6): cộng lại kho vật lý. Giữ chỗ không
  // đổi — đã được giải phóng cùng lúc với commit. Không cần điều kiện số lượng: cộng thêm không thể
  // vi phạm CHECK (stock >= 0, reserved_stock <= stock). Khác `release` (đơn chưa thanh toán, kho vật
  // lý chưa từng bị trừ). variant không còn (không xảy ra: FK RESTRICT) ⇒ báo lỗi, rollback cả giao dịch.
  async restock(tx: TxClient, lines: InventoryLine[]): Promise<void> {
    for (const { productVariantId, quantity } of normalizeLines(lines)) {
      const affected = await tx.$executeRaw`
        UPDATE product_variants
        SET stock = stock + ${quantity},
            updated_at = now() AT TIME ZONE 'UTC'
        WHERE id = ${productVariantId}`;
      if (affected !== 1) {
        throw new InventoryInvariantError('restock', productVariantId);
      }
    }
  }

  private async describeShortages(
    tx: TxClient,
    failed: { productVariantId: string; requested: number }[],
  ): Promise<StockShortage[]> {
    const rows = await tx.productVariant.findMany({
      where: { id: { in: failed.map((f) => f.productVariantId) } },
      select: { id: true, stock: true, reservedStock: true, isActive: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return failed.map(({ productVariantId, requested }) => {
      const row = byId.get(productVariantId);
      return {
        productVariantId,
        requested,
        available: row?.isActive ? row.stock - row.reservedStock : 0,
      };
    });
  }
}

// Gộp dòng trùng variant (cộng số lượng), kiểm số lượng nguyên dương, sắp theo id tăng dần.
export function normalizeLines(lines: InventoryLine[]): InventoryLine[] {
  const totals = new Map<string, number>();
  for (const { productVariantId, quantity } of lines) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new RangeError(
        `Invalid quantity ${quantity} for ${productVariantId}`,
      );
    }
    totals.set(
      productVariantId,
      (totals.get(productVariantId) ?? 0) + quantity,
    );
  }
  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([productVariantId, quantity]) => ({ productVariantId, quantity }));
}
