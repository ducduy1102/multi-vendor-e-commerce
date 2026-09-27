import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CartDiscount, CartView } from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { CreateVoucherDto } from './dto/create-voucher.dto';
import { calculateDiscount } from './voucher-discount';

// Chỉ field cần trả cho Seller (khớp voucherSchema ở packages/types).
const voucherSummarySelect = {
  id: true,
  shopId: true,
  code: true,
  type: true,
  value: true,
  minOrderAmount: true,
  maxDiscountAmount: true,
  usageLimit: true,
  perUserLimit: true,
  usedCount: true,
  isActive: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.VoucherSelect;

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
      throw new AppException(404, 'VOUCHER_NOT_FOUND', 'Voucher not found');
    }
    if (!voucher.isActive) {
      throw new AppException(400, 'VOUCHER_INACTIVE', 'Voucher is not active');
    }
    if (voucher.expiresAt && voucher.expiresAt <= new Date()) {
      throw new AppException(400, 'VOUCHER_EXPIRED', 'Voucher has expired');
    }
    if (
      voucher.usageLimit !== null &&
      voucher.usedCount >= voucher.usageLimit
    ) {
      throw new AppException(
        400,
        'VOUCHER_USAGE_LIMIT_REACHED',
        'Voucher usage limit has been reached',
      );
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
        throw new AppException(
          400,
          'VOUCHER_PER_USER_LIMIT_REACHED',
          'You have reached the usage limit for this voucher',
        );
      }
    }

    // Voucher theo shop chỉ tính trên subtotal của đúng shop đó, voucher
    // toàn sàn tính trên tổng giỏ (đều chỉ gồm item khả dụng, 1.9/1.11).
    const base = this.resolveBase(voucher.shopId, cart);
    if (base <= 0) {
      throw new AppException(
        400,
        'VOUCHER_NOT_APPLICABLE',
        'Voucher does not apply to any item in your cart',
      );
    }
    if (
      voucher.minOrderAmount !== null &&
      base < voucher.minOrderAmount.toNumber()
    ) {
      throw new AppException(
        400,
        'VOUCHER_BELOW_MINIMUM',
        `Order amount is below the voucher minimum (${voucher.minOrderAmount.toString()})`,
        // Số nguyên VND cho FE hiển thị (thay cho việc bóc số từ message).
        { minAmount: Math.ceil(voucher.minOrderAmount.toNumber()) },
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

  // shopId luôn lấy từ shop đã xác thực qua ShopOwnerGuard, không bao giờ từ
  // body (rules/backend.md mục 5). Voucher toàn sàn (shopId = null) không có
  // đường tạo qua API ở Tuần 6 — chỉ seed tay (Week6.md 1.14).
  async createVoucher(shopId: string, dto: CreateVoucherDto) {
    if (dto.expiresAt && new Date(dto.expiresAt) <= new Date()) {
      throw new BadRequestException('Expiry date must be in the future');
    }
    try {
      return await this.prisma.voucher.create({
        data: {
          shopId,
          code: dto.code.trim().toUpperCase(),
          type: dto.type,
          value: dto.value,
          minOrderAmount: dto.minOrderAmount,
          maxDiscountAmount: dto.maxDiscountAmount,
          usageLimit: dto.usageLimit,
          perUserLimit: dto.perUserLimit,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        },
        select: voucherSummarySelect,
      });
    } catch (error) {
      // code là @unique toàn hệ thống (không riêng từng shop) — model Voucher
      // là model unique duy nhất trong lệnh này nên P2002 chắc chắn do code.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppException(
          409,
          'VOUCHER_CODE_EXISTS',
          'Voucher code already exists',
        );
      }
      throw error;
    }
  }

  async listMyVouchers(shopId: string) {
    return this.prisma.voucher.findMany({
      where: { shopId },
      orderBy: { createdAt: 'desc' },
      select: voucherSummarySelect,
    });
  }

  // Bật/tắt tường minh (idempotent). Voucher của shop khác (hoặc toàn sàn)
  // coi như không tồn tại — cùng 404, không lộ voucher đó có thật hay không.
  async setVoucherActive(shopId: string, voucherId: string, isActive: boolean) {
    const existing = await this.prisma.voucher.findFirst({
      where: { id: voucherId, shopId },
      select: { id: true },
    });
    if (!existing) {
      throw new AppException(404, 'VOUCHER_NOT_FOUND', 'Voucher not found');
    }
    return this.prisma.voucher.update({
      where: { id: voucherId },
      data: { isActive },
      select: voucherSummarySelect,
    });
  }

  private resolveBase(shopId: string | null, cart: CartView): number {
    if (shopId === null) {
      return Number(cart.subtotal);
    }
    const group = cart.shops.find((shop) => shop.shopId === shopId);
    return group ? Number(group.subtotal) : 0;
  }
}
