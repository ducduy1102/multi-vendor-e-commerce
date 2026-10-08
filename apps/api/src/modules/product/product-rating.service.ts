import { Injectable, NotFoundException } from '@nestjs/common';
import type { TxClient } from '../../shared/prisma/tx-client';

export type RatingDistribution = {
  '1': number;
  '2': number;
  '3': number;
  '4': number;
  '5': number;
};

export interface RatingSummary {
  // 0 khi chưa có đánh giá nào; ngược lại nằm trong [1, 5], làm tròn 2 chữ số thập phân.
  avgRating: number;
  reviewCount: number;
}

// Kết quả `review.groupBy({ by: ['rating'], _count: { _all: true } })` → phân bố đủ 5 khoá cố định (mức
// không có đánh giá là 0). Rating ngoài 1-5 không thể có (CHECK reviews_rating_check) nên bị bỏ qua thay vì
// làm hỏng cả phân bố.
export function toDistribution(
  rows: readonly { rating: number; _count: { _all: number } }[],
): RatingDistribution {
  const distribution: RatingDistribution = {
    '1': 0,
    '2': 0,
    '3': 0,
    '4': 0,
    '5': 0,
  };
  for (const row of rows) {
    const key = String(row.rating) as keyof RatingDistribution;
    if (key in distribution) distribution[key] += row._count._all;
  }
  return distribution;
}

// MỘT công thức duy nhất cho điểm trung bình, dùng cho cả cột denormalized (ghi bởi `recompute`) lẫn phần tóm
// tắt ở trang đánh giá công khai — hai nơi cùng ra một con số. Làm tròn half-up 2 chữ số bằng SỐ NGUYÊN
// (floor((200·tổng + n) / 2n) / 100): `Math.round(x * 100) / 100` trên số thực có thể làm tròn sai ở các mốc như
// 4.285 (nhị phân lưu 4.28499…), trong khi tổng điểm và số lượt đều là số nguyên nên tính được chính xác.
export function summarizeRatings(
  distribution: RatingDistribution,
): RatingSummary {
  let reviewCount = 0;
  let total = 0;
  for (const star of [1, 2, 3, 4, 5] as const) {
    const count = distribution[String(star) as keyof RatingDistribution];
    reviewCount += count;
    total += star * count;
  }
  if (reviewCount === 0) return { avgRating: 0, reviewCount: 0 };
  const hundredths = Math.floor(
    (200 * total + reviewCount) / (2 * reviewCount),
  );
  return { avgRating: hundredths / 100, reviewCount };
}

// Điểm GHI DUY NHẤT của Product.avgRating/reviewCount (Week9.md 1.8, cùng mẫu InventoryService/
// ShopStatusService): cột denormalized có chủ đích vì Prisma không orderBy được theo aggregate của quan hệ
// 1-nhiều, mà danh sách public cần sort theo rating và card cần hiện sao. Không nơi nào khác được ghi 2 cột này.
//
// Quy ước chung như InventoryService: nhận `tx` đầu tiên và KHÔNG tự mở $transaction.
//
// KHOÁ DÒNG PRODUCT TRƯỚC KHI CHÈN/SỬA REVIEW, không phải trước khi tính lại: chèn review làm Postgres giữ
// `FOR KEY SHARE` trên dòng product (qua FK); nếu hai review của cùng một sản phẩm cùng chèn xong rồi mới xin
// `FOR UPDATE` để tính lại thì mỗi bên giữ KEY SHARE chờ bên kia nhả ⇒ deadlock. Khoá `FOR UPDATE` ngay từ đầu
// làm các thay đổi của cùng một sản phẩm xếp hàng thay vì chờ vòng. Dùng `updateRating` — nó ép đúng thứ tự
// khoá → thay đổi → tính lại, người gọi không thể làm sai thứ tự.
@Injectable()
export class ProductRatingService {
  // Chạy `change` (chèn/sửa review) NẰM GIỮA khoá dòng product và lần tính lại. `change` ném lỗi ⇒ giao dịch của
  // người gọi rollback, khoá nhả theo.
  async updateRating<T>(
    tx: TxClient,
    productId: string,
    change: () => Promise<T>,
  ): Promise<T> {
    await this.lockProduct(tx, productId);
    const result = await change();
    await this.recompute(tx, productId);
    return result;
  }

  // Tính lại từ aggregate (không cộng/trừ tăng dần) nên tự chữa lành nếu từng có lệch. Tự khoá dòng product
  // trước (xin lại khoá đã giữ trong cùng transaction là no-op) để lần tính này luôn nhìn thấy mọi review đã
  // commit trước nó — dùng được độc lập để vá số liệu, không chỉ qua `updateRating`.
  //
  // Ghi bằng SQL thô thay vì `product.update`: `@updatedAt` của Prisma sẽ đẩy `updated_at` mỗi lần có đánh giá
  // mới, trong khi cột đó mang nghĩa "nội dung sản phẩm được sửa". Trigger tìm kiếm chỉ chạy khi name/
  // description đổi nên cũng không bị đánh thức.
  async recompute(tx: TxClient, productId: string): Promise<RatingSummary> {
    await this.lockProduct(tx, productId);
    const rows = await tx.review.groupBy({
      by: ['rating'],
      where: { productId },
      _count: { _all: true },
    });
    const summary = summarizeRatings(toDistribution(rows));
    await tx.$executeRaw`
      UPDATE products
      SET avg_rating = ${summary.avgRating}::double precision,
          review_count = ${summary.reviewCount}::integer
      WHERE id = ${productId}`;
    return summary;
  }

  private async lockProduct(tx: TxClient, productId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;
    if (rows.length === 0) {
      throw new NotFoundException('Product not found');
    }
  }
}
