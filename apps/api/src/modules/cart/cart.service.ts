import { Injectable, NotFoundException } from '@nestjs/common';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  isVariantAvailable,
  variantAvailabilitySelect,
} from './cart-availability';
import { MAX_CART_LINES, type CartView } from '@ecommerce/types';
import { availableStock } from '../../shared/utils/available-stock';
import { VoucherService } from '../voucher/voucher.service';
import { applyDiscount, cartVariantSelect, composeCartView } from './cart-view';

export interface CartItemInput {
  productVariantId: string;
  quantity: number;
}

export interface CartItemRow extends CartItemInput {
  id: string;
}

const cartItemSelect = {
  id: true,
  productVariantId: true,
  quantity: true,
} as const;

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly voucherService: VoucherService,
  ) {}

  // Đọc thô các dòng giỏ của user theo thứ tự thêm (Week6.md 1.3) để đưa vào
  // buildCartView (Bước 2.3) — chưa join giá/shop ở đây.
  async getCartItems(userId: string): Promise<CartItemRow[]> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      select: {
        items: { orderBy: { createdAt: 'asc' }, select: cartItemSelect },
      },
    });
    return cart?.items ?? [];
  }

  // Giỏ của user đã đăng nhập, cùng shape CartView với guest (Week6.md 1.7).
  async getCart(userId: string, voucherCode?: string): Promise<CartView> {
    const view = await this.buildCartView(await this.getCartItems(userId));
    return this.withVoucher(view, voucherCode, userId);
  }

  // Giỏ guest: client gửi thẳng items[] (lưu ở localStorage), BE chỉ join
  // giá/tên/tồn kho live và dựng cùng CartView — public, không cần đăng nhập.
  async quote(
    items: CartItemInput[],
    voucherCode?: string,
    userId?: string,
  ): Promise<CartView> {
    const lines = [...this.sumByVariant(items)].map(
      ([productVariantId, quantity]) => ({
        id: null,
        productVariantId,
        quantity,
      }),
    );
    const view = await this.buildCartView(lines);
    return this.withVoucher(view, voucherCode, userId);
  }

  // Không có mã (hoặc chỉ toàn khoảng trắng) thì giữ nguyên view; có mã thì
  // validate — mã sai/hết hạn... ném lỗi 4xx rõ lý do để FE hiện cạnh ô nhập.
  private async withVoucher(
    view: CartView,
    voucherCode: string | undefined,
    userId?: string,
  ): Promise<CartView> {
    if (!voucherCode?.trim()) {
      return view;
    }
    const discount = await this.voucherService.validate(
      voucherCode,
      view,
      userId,
    );
    return applyDiscount(view, discount);
  }

  // Join dữ liệu variant/product/shop rồi giao cho composeCartView (hàm thuần).
  // Variant không còn trong DB (guest giữ id cũ) bị bỏ qua thầm lặng, giống
  // mergeGuestCart.
  async buildCartView(
    items: Array<CartItemInput & { id: string | null }>,
  ): Promise<CartView> {
    if (items.length === 0) {
      return composeCartView([]);
    }
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: items.map((item) => item.productVariantId) } },
      select: cartVariantSelect,
    });
    const variantById = new Map(variants.map((v) => [v.id, v]));
    const lines = items.flatMap((item) => {
      const variant = variantById.get(item.productVariantId);
      return variant ? [{ ...item, variant }] : [];
    });
    return composeCartView(lines);
  }

  // Cộng dồn nếu variant đã có trong giỏ, chặn mềm theo số lượng còn đặt được
  // (available = stock - reservedStock, Week7.md 1.3). Check rồi ghi là
  // read-then-write có chủ đích: đây chỉ là chặn mềm cho UX, chặn thật (giữ chỗ
  // tồn kho có điều kiện trong transaction) nằm ở checkout. Trần MAX_CART_LINES
  // cũng chặn mềm như vậy (2 request đồng thời có thể vượt 1-2 dòng, không đáng khoá).
  async addItem(
    userId: string,
    productVariantId: string,
    quantity: number,
  ): Promise<CartItemRow> {
    const variant = await this.findAvailableVariant(productVariantId);
    const cartId = await this.getOrCreateCartId(userId);

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_productVariantId: { cartId, productVariantId } },
      select: { quantity: true },
    });
    if (!existing && (await this.countCartLines(cartId)) >= MAX_CART_LINES) {
      throw new AppException(
        409,
        'CART_FULL',
        `Cart is full (max ${MAX_CART_LINES} items)`,
        { maxLines: MAX_CART_LINES },
      );
    }
    const nextQuantity = (existing?.quantity ?? 0) + quantity;
    this.assertWithinStock(nextQuantity, availableStock(variant));

    return this.prisma.cartItem.upsert({
      where: { cartId_productVariantId: { cartId, productVariantId } },
      create: { cartId, productVariantId, quantity: nextQuantity },
      update: { quantity: nextQuantity },
      select: cartItemSelect,
    });
  }

  // itemId là khoá chính của CartItem; where kèm cart.userId để chỉ thao tác
  // được trên giỏ của chính mình, item của người khác coi như không tồn tại.
  async updateItemQuantity(
    userId: string,
    itemId: string,
    quantity: number,
  ): Promise<CartItemRow> {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cart: { userId } },
      select: { productVariant: { select: variantAvailabilitySelect } },
    });
    if (!item) {
      throw new NotFoundException('Cart item not found');
    }
    if (!isVariantAvailable(item.productVariant)) {
      throw new AppException(
        409,
        'CART_ITEM_UNAVAILABLE',
        'This product is no longer available',
      );
    }
    this.assertWithinStock(quantity, availableStock(item.productVariant));

    return this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity },
      select: cartItemSelect,
    });
  }

  // Idempotent — deleteMany không throw khi không khớp record nào (giống
  // WishlistService.removeFromWishlist), đồng thời where đã kiểm quyền sở hữu.
  async removeItem(userId: string, itemId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({
      where: { id: itemId, cart: { userId } },
    });
  }

  // Gộp giỏ guest vào giỏ DB sau khi đăng nhập (1.8): cộng dồn theo variant,
  // clamp theo số lượng còn đặt được, bỏ qua thầm lặng variant không còn tồn
  // tại/không khả dụng/hết hàng thay vì lỗi cả request. Giỏ đã đủ
  // MAX_CART_LINES thì giữ dòng có sẵn trước, thêm dòng guest theo thứ tự tới đủ
  // trần, phần thừa bị bỏ và ĐƯỢC ĐẾM để FE báo (Week7.md 1.12).
  async mergeGuestCart(
    userId: string,
    items: CartItemInput[],
  ): Promise<{ droppedLineCount: number }> {
    const wanted = this.sumByVariant(items);
    if (wanted.size === 0) {
      return { droppedLineCount: 0 };
    }
    const variantIds = [...wanted.keys()];

    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: { id: true, ...variantAvailabilitySelect },
    });
    const cartId = await this.getOrCreateCartId(userId);
    const existingItems = await this.prisma.cartItem.findMany({
      where: { cartId, productVariantId: { in: variantIds } },
      select: { productVariantId: true, quantity: true },
    });
    const existingByVariant = new Map(
      existingItems.map((item) => [item.productVariantId, item.quantity]),
    );

    // findMany không đảm bảo thứ tự — sắp lại theo thứ tự dòng guest để "thêm theo
    // thứ tự tới đủ trần" xác định được.
    const orderIndex = new Map(variantIds.map((id, index) => [id, index]));
    const orderedVariants = [...variants].sort(
      (a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0),
    );

    let freeSlots = MAX_CART_LINES - (await this.countCartLines(cartId));
    let droppedLineCount = 0;
    const writes = orderedVariants.flatMap((variant) => {
      if (!isVariantAvailable(variant)) {
        return [];
      }
      const isNewLine = !existingByVariant.has(variant.id);
      const total =
        (existingByVariant.get(variant.id) ?? 0) +
        (wanted.get(variant.id) ?? 0);
      const quantity = Math.min(total, availableStock(variant));
      if (quantity <= 0) {
        return [];
      }
      if (isNewLine) {
        if (freeSlots <= 0) {
          droppedLineCount += 1;
          return [];
        }
        freeSlots -= 1;
      }
      return [
        this.prisma.cartItem.upsert({
          where: {
            cartId_productVariantId: { cartId, productVariantId: variant.id },
          },
          create: { cartId, productVariantId: variant.id, quantity },
          update: { quantity },
        }),
      ];
    });
    await this.prisma.$transaction(writes);
    return { droppedLineCount };
  }

  private countCartLines(cartId: string): Promise<number> {
    return this.prisma.cartItem.count({ where: { cartId } });
  }

  private sumByVariant(items: CartItemInput[]): Map<string, number> {
    const totals = new Map<string, number>();
    for (const { productVariantId, quantity } of items) {
      totals.set(
        productVariantId,
        (totals.get(productVariantId) ?? 0) + quantity,
      );
    }
    return totals;
  }

  // Cart luôn được tạo kèm userId (Week6.md 1.1: userId nullable ở DB nhưng
  // không bao giờ có row Cart thiếu userId).
  private async getOrCreateCartId(userId: string): Promise<string> {
    const cart = await this.prisma.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { id: true },
    });
    return cart.id;
  }

  private async findAvailableVariant(productVariantId: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: productVariantId },
      select: variantAvailabilitySelect,
    });
    if (!variant) {
      throw new NotFoundException('Product variant not found');
    }
    if (!isVariantAvailable(variant)) {
      throw new AppException(
        409,
        'CART_ITEM_UNAVAILABLE',
        'This product is no longer available',
      );
    }
    return variant;
  }

  private assertWithinStock(quantity: number, stock: number): void {
    if (quantity > stock) {
      throw new AppException(
        409,
        'INSUFFICIENT_STOCK',
        `Quantity exceeds available stock (${stock})`,
        { available: stock },
      );
    }
  }
}
