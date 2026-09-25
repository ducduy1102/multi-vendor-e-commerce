import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CartDiscount, CartView } from '@ecommerce/types';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { calculateDiscount } from './voucher-discount';

@Injectable()
export class VoucherService {
  constructor(private readonly prisma: PrismaService) {}

  // Kiểm tra 1 mã với giỏ hiện tại rồi trả số tiền giảm dự kiến (Week6.md
  // 1.11-1.13). Chỉ đọc để preview: KHÔNG tăng usedCount, không gắn vào Order
  // — lượt dùng thật ghi ở Tuần 7 bằng update có điều kiện
  // (WHERE usedCount < usageLimit) trong cùng $transaction tạo Order, không
  // đọc-rồi-ghi tách rời. Mỗi lý do từ chối có 1 message riêng, không gộp.
  async validate(
    code: string,
    cart: CartView,
    userId?: string,
  ): Promise<CartDiscount> {
    const voucher = await this.prisma.voucher.findUnique({
      where: { code: code.trim().toUpperCase() },
      select: {
        id: true,
        code: true,
        shopId: true,
        type: true,
        value: true,
        minOrderAmount: true,
        maxDiscountAmount: true,
        usageLimit: true,
        perUserLimit: true,
        usedCount: true,
        isActive: true,
        expiresAt: true,
      },
    });
    if (!voucher) {
      throw new NotFoundException('Voucher not found');
    }
    if (!voucher.isActive) {
      throw new BadRequestException('Voucher is not active');
    }
    if (voucher.expiresAt && voucher.expiresAt <= new Date()) {
      throw new BadRequestException('Voucher has expired');
    }
    if (
      voucher.usageLimit !== null &&
      voucher.usedCount >= voucher.usageLimit
    ) {
      throw new BadRequestException('Voucher usage limit has been reached');
    }

    // Guest (không có userId) bỏ qua perUserLimit khi preview (1.13) — Tuần 7
    // bắt buộc enforce lại lúc tạo Order thật.
    if (voucher.perUserLimit !== null && userId) {
      const used = await this.prisma.order.count({
        where: {
          voucherId: voucher.id,
          userId,
          status: { not: 'CANCELLED' },
        },
      });
      if (used >= voucher.perUserLimit) {
        throw new BadRequestException(
          'You have reached the usage limit for this voucher',
        );
      }
    }

    // Voucher theo shop chỉ tính trên subtotal của đúng shop đó, voucher
    // toàn sàn tính trên tổng giỏ (đều chỉ gồm item khả dụng, 1.9/1.11).
    const base = this.resolveBase(voucher.shopId, cart);
    if (base <= 0) {
      throw new BadRequestException(
        'Voucher does not apply to any item in your cart',
      );
    }
    if (
      voucher.minOrderAmount !== null &&
      base < voucher.minOrderAmount.toNumber()
    ) {
      throw new BadRequestException(
        `Order amount is below the voucher minimum (${voucher.minOrderAmount.toString()})`,
      );
    }

    const amount = calculateDiscount(
      {
        type: voucher.type,
        value: voucher.value.toNumber(),
        maxDiscountAmount: voucher.maxDiscountAmount?.toNumber() ?? null,
      },
      base,
    );
    return {
      code: voucher.code,
      shopId: voucher.shopId,
      amount: String(amount),
    };
  }

  private resolveBase(shopId: string | null, cart: CartView): number {
    if (shopId === null) {
      return Number(cart.subtotal);
    }
    const group = cart.shops.find((shop) => shop.shopId === shopId);
    return group ? Number(group.subtotal) : 0;
  }
}
