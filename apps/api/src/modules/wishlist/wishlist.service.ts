import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';

// Đủ field cho ProductCard (packages/types productCardSchema) + status/
// shop.status chỉ dùng NỘI BỘ để tính isAvailable (Week5.md Bước 1.17) —
// KHÔNG lộ 2 field này ra response, destructure bỏ tường minh ở mapItem()
// (cùng lý do/đúng bug đã gặp ở ProductService.getProduct, rules/backend.md
// mục 4 — không dựa vào type hẹp hơn để "ẩn" field lúc runtime).
const wishlistProductSelect = {
  id: true,
  categoryId: true,
  name: true,
  slug: true,
  minPrice: true,
  maxPrice: true,
  // Điểm đánh giá denormalized (Week9.md 1.8) — wishlist dùng chung shape ProductCard.
  avgRating: true,
  reviewCount: true,
  status: true,
  shop: { select: { status: true } },
  variants: {
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    take: 1,
    select: {
      images: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
    },
  },
} satisfies Prisma.ProductSelect;

type WishlistProductRow = Prisma.ProductGetPayload<{
  select: typeof wishlistProductSelect;
}>;

export interface WishlistItemSummary {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  minPrice: Prisma.Decimal;
  maxPrice: Prisma.Decimal;
  imageUrl: string | null;
  avgRating: number;
  reviewCount: number;
  isAvailable: boolean;
}

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  // Toggle "thêm" 1 chiều — đã wishlist rồi thì coi là thành công luôn
  // (idempotent, không 409), đúng UX toggle heart icon 2 chiều (Week5.md
  // Bước 2.6). @@unique([userId, productId]) là trọng tài cuối cùng chống
  // race condition, không dựa vào check tồn tại trước (rules/backend.md mục
  // 4 — check trước rẻ nhưng không đủ an toàn 1 mình).
  async addToWishlist(userId: string, productId: string): Promise<void> {
    try {
      await this.prisma.wishlist.create({ data: { userId, productId } });
    } catch (error) {
      if (this.isAlreadyWishlisted(error)) {
        return;
      }
      throw error;
    }
  }

  // Cũng idempotent — không lỗi nếu vốn chưa từng wishlist. deleteMany thay
  // vì delete() vì delete() throw P2025 khi where không khớp record nào.
  async removeFromWishlist(userId: string, productId: string): Promise<void> {
    await this.prisma.wishlist.deleteMany({ where: { userId, productId } });
  }

  async checkIsWishlisted(userId: string, productId: string): Promise<boolean> {
    const existing = await this.prisma.wishlist.findUnique({
      where: { userId_productId: { userId, productId } },
      select: { id: true },
    });
    return existing !== null;
  }

  // Đúng của user gọi (where: {userId}) — không lộ wishlist user khác.
  async listMyWishlist(userId: string): Promise<WishlistItemSummary[]> {
    const rows = await this.prisma.wishlist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { product: { select: wishlistProductSelect } },
    });
    return rows.map((row) => this.mapItem(row.product));
  }

  private mapItem(product: WishlistProductRow): WishlistItemSummary {
    const { status, shop, variants, ...rest } = product;
    return {
      ...rest,
      imageUrl: variants[0]?.images[0]?.url ?? null,
      isAvailable: status === 'PUBLISHED' && shop.status === 'APPROVED',
    };
  }

  private isAlreadyWishlisted(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
