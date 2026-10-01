import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  BlockingIssue,
  CartView,
  CheckoutPreview,
  CheckoutPreviewOrder,
  ExcludedItem,
  PaymentMethod,
  PreviewCheckoutInput,
} from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { TxClient } from '../../shared/prisma/tx-client';
import { readPaymentTtlMinutes } from '../../shared/payment/payment-config';
import { PaymentGatewayService } from '../../shared/payment/payment-gateway.service';
import { generateTxnRef } from '../../shared/payment/txn-ref';
import { CartService } from '../cart/cart.service';
import {
  InsufficientStockError,
  InventoryService,
} from '../product/inventory.service';
import { OrderService } from '../order/order.service';
import {
  PaymentService,
  type CheckoutGroupView,
  type RetryPaymentResult,
} from '../order/payment.service';
import { VoucherService } from '../voucher/voucher.service';
import { VoucherUsageService } from '../voucher/voucher-usage.service';
import { AddressService } from './address.service';
import { readMaxPendingCheckouts } from './checkout-config';
import {
  buildCheckoutPlan,
  resolveDiscountByShop,
  type CheckoutPlanShop,
  type CheckoutPlanVoucher,
} from './checkout-pricing';
import {
  calculateShippingFee,
  readDefaultOriginProvince,
} from './shipping-rates';

export interface PlaceOrderInput {
  addressId: string;
  paymentMethod: PaymentMethod;
  voucherCode?: string;
  // = grandTotal của lần xem trước (2.7b) — bắt buộc (Week7.md 1.11 (3)).
  expectedTotal: number;
}

export interface PlaceOrderResultOrder {
  id: string;
  shopId: string;
  status: string;
  totalAmount: string;
}

export interface PlaceOrderResult {
  checkoutGroupId: string;
  orders: PlaceOrderResultOrder[];
  totalAmount: string;
  paymentMethod: PaymentMethod;
  expiresAt: string;
  paymentUrl: string | null;
}

interface AvailableLine {
  cartItemId: string;
  productVariantId: string;
  quantity: number;
  shopId: string;
  shopName: string;
  shopSlug: string;
}

interface VariantMetadata {
  productName: string;
  variantLabel: string | null;
  sku: string;
  imageUrl: string | null;
  weightGram: number | null;
}

// "Trái tim của tuần" (Week7.md 2.7) — điều phối 1 lần đặt hàng trong ĐÚNG 1 prisma.$transaction.
// CheckoutService là NGƯỜI ĐIỀU PHỐI: gọi InventoryService/VoucherUsageService/OrderService (mỗi
// service con nhận `tx` làm tham số đầu, không tự mở transaction lồng — Week7.md 1.14), không viết
// SQL kho/voucher trực tiếp ở đây và không ghi thẳng vào bảng của module `order`.
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly voucherService: VoucherService,
    private readonly voucherUsageService: VoucherUsageService,
    private readonly inventoryService: InventoryService,
    private readonly orderService: OrderService,
    private readonly addressService: AddressService,
    private readonly paymentGateway: PaymentGatewayService,
    private readonly paymentService: PaymentService,
  ) {}

  // Route đặt ở checkout (nhóm thanh toán là thực thể của checkout theo domain-erd.md) nhưng đơn
  // thuần gọi qua PaymentService của module order — order sở hữu Order/Payment (Week7.md 1.14).
  getCheckoutGroup(
    userId: string,
    groupId: string,
  ): Promise<CheckoutGroupView> {
    return this.paymentService.getCheckoutGroup(userId, groupId);
  }

  retryPayment(userId: string, groupId: string): Promise<RetryPaymentResult> {
    return this.paymentService.retryPayment(userId, groupId);
  }

  async placeOrder(
    userId: string,
    input: PlaceOrderInput,
    idempotencyKey?: string,
  ): Promise<PlaceOrderResult> {
    // [0] Phát lại cùng Idempotency-Key sau khi đã thành công — trả lại đúng kết quả cũ, không làm
    // lại gì (Week7.md 1.11 (4)).
    if (idempotencyKey) {
      const existing = await this.findExistingResult(userId, idempotencyKey);
      if (existing) return existing;
    }

    // [1] Fail-fast, KHÔNG khoá gì — chặn sớm các ca chắc chắn không đặt được trước khi tốn công
    // giữ chỗ tồn kho.
    const address = await this.addressService.getOwnedAddressOrThrow(
      userId,
      input.addressId,
    );

    const cartItems = await this.cartService.getCartItems(userId);
    const cartView = await this.cartService.buildCartView(cartItems);
    const purchasableLines = this.extractPurchasableLines(cartView);
    if (purchasableLines.length === 0) {
      throw new AppException(
        400,
        'NO_PURCHASABLE_ITEMS',
        'Cart has no purchasable items',
      );
    }

    const availability = this.paymentGateway.availabilityOf(
      input.paymentMethod,
      input.expectedTotal,
    );
    if (!availability.available) {
      throw new AppException(
        409,
        'PAYMENT_METHOD_UNAVAILABLE',
        `Payment method ${input.paymentMethod} is not available`,
        { method: input.paymentMethod, reason: availability.reason! },
      );
    }

    const maxPendingCheckouts = readMaxPendingCheckouts();
    const pendingBefore = await this.countPendingGroups(this.prisma, userId);
    if (pendingBefore.length >= maxPendingCheckouts) {
      throw new AppException(
        409,
        'TOO_MANY_PENDING_CHECKOUTS',
        'Too many pending checkouts',
        {
          pendingGroupIds: pendingBefore,
        },
      );
    }

    // [2..6] transaction
    let created: {
      groupId: string;
      orders: PlaceOrderResultOrder[];
      txnRef: string;
      amount: number;
      expiresAt: Date;
    };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // [2] Xoá đúng các dòng đã đọc (khớp id + quantity) — ổ khoá theo user; lệch ⇒ giỏ đã đổi.
        const { count: deletedCount } = await tx.cartItem.deleteMany({
          where: {
            OR: purchasableLines.map((l) => ({
              id: l.cartItemId,
              quantity: l.quantity,
            })),
          },
        });
        if (deletedCount !== purchasableLines.length) {
          throw new AppException(
            409,
            'CART_CHANGED',
            'Cart changed since it was read',
          );
        }

        // Kiểm lại trong transaction — đã khoá theo user nên không thể 2 request cùng lọt.
        const pendingInTx = await this.countPendingGroups(tx, userId);
        if (pendingInTx.length >= maxPendingCheckouts) {
          throw new AppException(
            409,
            'TOO_MANY_PENDING_CHECKOUTS',
            'Too many pending checkouts',
            {
              pendingGroupIds: pendingInTx,
            },
          );
        }

        const group = await tx.checkoutGroup.create({
          data: { userId, idempotencyKey: idempotencyKey ?? null },
          select: { id: true },
        });

        const variantIds = [
          ...new Set(purchasableLines.map((l) => l.productVariantId)),
        ];
        const metadata = await this.loadItemMetadata(tx, variantIds);

        // [3] Giữ chỗ tồn kho — InventoryService tự duyệt theo id tăng dần (chống deadlock).
        let prices: Map<string, Prisma.Decimal>;
        try {
          prices = await this.inventoryService.reserve(
            tx,
            purchasableLines.map((l) => ({
              productVariantId: l.productVariantId,
              quantity: l.quantity,
            })),
          );
        } catch (error) {
          if (error instanceof InsufficientStockError) {
            throw new AppException(
              409,
              'OUT_OF_STOCK',
              'Insufficient stock for one or more items',
              {
                items: error.shortages.map((s) => ({
                  productVariantId: s.productVariantId,
                  productName:
                    metadata.get(s.productVariantId)?.productName ?? '',
                  variantLabel:
                    metadata.get(s.productVariantId)?.variantLabel ?? null,
                  available: s.available,
                })),
              },
            );
          }
          throw error;
        }

        // [4] Kế hoạch đơn từ giá ĐÃ KHOÁ + voucher (nếu có).
        const originProvince = readDefaultOriginProvince();
        const shops = this.buildShopsForPlan(
          purchasableLines,
          prices,
          metadata,
          originProvince,
        );

        let voucherId: string | null = null;
        let voucherContext: CheckoutPlanVoucher | null = null;
        if (input.voucherCode?.trim()) {
          const shopSubtotals = shops.map((s) => ({
            shopId: s.shopId,
            subtotal: s.items.reduce(
              (sum, item) => sum + item.unitPrice * item.quantity,
              0,
            ),
          }));
          // Tái dùng VoucherService.validate (không viết lại luật lần 2, Week7.md 2.8) — dựng
          // CartView tổng hợp từ subtotal ĐÃ KHOÁ để số giảm tính đúng trên giá thật lúc chốt.
          const discount = await this.voucherService.validate(
            input.voucherCode,
            this.buildSyntheticCartView(shopSubtotals),
            userId,
          );
          const voucherRow = await tx.voucher.findUnique({
            where: { code: input.voucherCode.trim().toUpperCase() },
            select: { id: true, perUserLimit: true },
          });
          if (!voucherRow) {
            throw new AppException(
              404,
              'VOUCHER_NOT_FOUND',
              'Voucher not found',
            );
          }
          voucherId = voucherRow.id;
          voucherContext = {
            shopId: discount.shopId,
            amount: Number(discount.amount),
          };

          // Thứ tự bắt buộc (1.5): tăng usedCount → đếm perUserLimit → INSERT VoucherUsage.
          // discountAmount insert TẠM bằng số dự kiến; ghi số THẬT (= Σ Order.discountAmount của
          // plan cuối) ngay dưới đây trước khi build plan, vì allocateDiscount không đổi tổng.
          await this.voucherUsageService.consume(tx, {
            voucherId,
            userId,
            checkoutGroupId: group.id,
            discountAmount: voucherContext.amount,
            perUserLimit: voucherRow.perUserLimit,
          });
        }

        const plan = buildCheckoutPlan({
          shops,
          destinationProvince: address.province,
          voucher: voucherContext,
        });

        // [5] So expectedTotal — lệch thì rollback TOÀN BỘ (ném lỗi tự cuốn theo cả transaction).
        if (plan.grandTotal !== input.expectedTotal) {
          throw new AppException(
            409,
            'PRICE_CHANGED',
            'Price changed since preview',
            {
              expectedTotal: input.expectedTotal,
              currentTotal: plan.grandTotal,
            },
          );
        }

        // [6] Tạo Order/OrderItem/Payment qua OrderService (order sở hữu các bảng này).
        const txnRef = generateTxnRef();
        const expiresAt = new Date(
          Date.now() + readPaymentTtlMinutes() * 60_000,
        );
        const { orders } = await this.orderService.createOrders(tx, {
          checkoutGroupId: group.id,
          userId,
          voucherId,
          shipping: {
            recipientName: address.recipientName,
            recipientPhone: address.phone,
            shippingAddressLine: address.line1,
            shippingWard: address.ward,
            shippingProvince: address.province,
          },
          orders: plan.orders.map((o) => ({
            shopId: o.shopId,
            shippingFee: o.shippingFee,
            discountAmount: o.discountAmount,
            totalAmount: o.totalAmount,
            items: o.items.map((item) => ({
              productVariantId: item.productVariantId,
              productName: item.productName,
              variantLabel: item.variantLabel,
              sku: item.sku,
              imageUrl: item.imageUrl,
              quantity: item.quantity,
              priceAtPurchase: item.unitPrice,
            })),
          })),
          payment: {
            method: input.paymentMethod,
            amount: plan.grandTotal,
            txnRef,
            expiresAt,
          },
        });

        return {
          groupId: group.id,
          orders,
          txnRef,
          amount: plan.grandTotal,
          expiresAt,
        };
      });
    } catch (error) {
      // Bấm đúp cùng Idempotency-Key: request thắng cuộc đã commit trước khi request này chạm tới
      // CheckoutGroup/CartItem — tra lại theo key rồi trả kết quả CŨ thay vì báo lỗi (Week7.md 1.11 (4)).
      if (
        idempotencyKey &&
        (this.isCartChanged(error) || this.isCheckoutGroupP2002(error))
      ) {
        const existing = await this.findExistingResult(userId, idempotencyKey);
        if (existing) return existing;
      }
      throw error;
    }

    // [7] Ngoài transaction: gọi cổng lấy payUrl. Lỗi ở bước này KHÔNG rollback phần đã ghi — đơn
    // vẫn AWAITING_PAYMENT, "tiếp tục thanh toán" ở 2.9 xử lý (rules/backend.md mục 4).
    const paymentUrl = await this.createPayUrlSafely(
      input.paymentMethod,
      created,
    );

    return {
      checkoutGroupId: created.groupId,
      orders: created.orders,
      totalAmount: String(created.amount),
      paymentMethod: input.paymentMethod,
      expiresAt: created.expiresAt.toISOString(),
      paymentUrl,
    };
  }

  // POST /checkout/preview (2.7b) — xem trước, KHÔNG ghi DB/giữ chỗ/tăng usedCount. Dùng đúng
  // resolveDiscountByShop mà buildCheckoutPlan/placeOrder dùng (1 nguồn chia giảm giá duy nhất);
  // khác placeOrder ở chỗ giá LUÔN đọc live (không có bước khoá/reserve) và `items` trả nguyên
  // CartLine của CartView (đúng checkoutPreviewSchema — không cần snapshot sku/ảnh như OrderItem).
  async preview(
    userId: string,
    input: PreviewCheckoutInput,
  ): Promise<CheckoutPreview> {
    const cartItems = await this.cartService.getCartItems(userId);
    const cartView = await this.cartService.buildCartView(cartItems);

    const excludedItems: ExcludedItem[] = cartView.shops.flatMap((shop) =>
      shop.items
        .filter((item) => !item.isAvailable)
        .map((item) => ({
          cartItemId: item.id as string,
          name: item.productName,
          reason: 'UNAVAILABLE' as const,
        })),
    );

    const blockingIssues: BlockingIssue[] = cartView.shops.flatMap((shop) =>
      shop.items
        .filter((item) => item.isAvailable && item.quantity > item.stock)
        .map((item) => ({
          cartItemId: item.id as string,
          type: 'INSUFFICIENT_STOCK' as const,
          available: item.stock,
        })),
    );

    // Cùng luật "khả dụng để mua" với placeOrder (1.12: mọi dòng isAvailable, không tự lọc theo
    // tồn kho — vượt tồn kho chỉ được BÁO qua blockingIssues, không bị loại khỏi tổng ở đây).
    const purchasableShops = cartView.shops
      .map((shop) => ({
        ...shop,
        items: shop.items.filter((item) => item.isAvailable),
      }))
      .filter((shop) => shop.items.length > 0);
    if (purchasableShops.length === 0) {
      throw new AppException(
        400,
        'NO_PURCHASABLE_ITEMS',
        'Cart has no purchasable items',
      );
    }

    // Địa chỉ TUỲ CHỌN (khác placeOrder) — chưa chọn thì không đoán phí ship (needsAddress).
    const address = input.addressId
      ? await this.addressService.getOwnedAddressOrThrow(
          userId,
          input.addressId,
        )
      : null;

    // Voucher validate trên CHÍNH cartView (giá live, chưa khoá) — không cần dựng CartView tổng hợp
    // như placeOrder vì preview không có bước khoá giá; nhờ vậy số giảm ở đây LUÔN khớp với
    // GET /cart, POST /cart/quote cho cùng giỏ + cùng mã (cùng input, cùng hàm validate).
    let discount: CartView['discount'] = null;
    let voucherContext: CheckoutPlanVoucher | null = null;
    if (input.voucherCode?.trim()) {
      discount = await this.voucherService.validate(
        input.voucherCode,
        cartView,
        userId,
      );
      voucherContext = {
        shopId: discount.shopId,
        amount: Number(discount.amount),
      };
    }

    const discountByShop = resolveDiscountByShop(
      purchasableShops.map((shop) => ({
        shopId: shop.shopId,
        subtotal: Number(shop.subtotal),
      })),
      voucherContext,
    );

    // weightGram chỉ cần khi ĐÃ có địa chỉ (mới tính shippingFee) — không đoán/không query thừa khi
    // needsAddress.
    let weightByVariant: Map<string, number | null> | null = null;
    if (address) {
      const variantIds = [
        ...new Set(
          purchasableShops.flatMap((s) =>
            s.items.map((i) => i.productVariantId),
          ),
        ),
      ];
      const rows = await this.prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, weightGram: true },
      });
      weightByVariant = new Map(rows.map((r) => [r.id, r.weightGram]));
    }
    const originProvince = readDefaultOriginProvince();

    const orders: CheckoutPreviewOrder[] = purchasableShops.map((shop) => {
      const subtotalValue = Number(shop.subtotal);
      const discountAmount = discountByShop.get(shop.shopId) ?? 0;
      const shippingFee = address
        ? calculateShippingFee({
            originProvince,
            destinationProvince: address.province,
            items: shop.items.map((item) => ({
              weightGram: weightByVariant!.get(item.productVariantId) ?? null,
              quantity: item.quantity,
            })),
          })
        : null;
      const total =
        shippingFee === null
          ? null
          : subtotalValue - discountAmount + shippingFee;
      return {
        shopId: shop.shopId,
        shopName: shop.shopName,
        shopSlug: shop.shopSlug,
        items: shop.items,
        subtotal: shop.subtotal,
        shippingFee: shippingFee === null ? null : String(shippingFee),
        discountAmount: String(discountAmount),
        total: total === null ? null : String(total),
      };
    });

    const subtotalTotal = orders.reduce(
      (sum, o) => sum + Number(o.subtotal),
      0,
    );
    const discountTotal = orders.reduce(
      (sum, o) => sum + Number(o.discountAmount),
      0,
    );
    const shippingTotal = address
      ? orders.reduce((sum, o) => sum + Number(o.shippingFee), 0)
      : null;
    const grandTotal = address
      ? orders.reduce((sum, o) => sum + Number(o.total), 0)
      : null;

    // needsAddress ⇒ chưa biết shippingFee thật; dùng subtotal đã trừ giảm giá làm số tạm để quyết
    // định phương thức khả dụng (shipping chỉ CỘNG THÊM, placeOrder luôn kiểm lại nên sai lệch ở
    // đây không mở đường vượt qua sàn/trần thật).
    const paymentMethods = this.paymentGateway.getAvailability(
      grandTotal ?? subtotalTotal - discountTotal,
    );

    return {
      orders,
      subtotal: String(subtotalTotal),
      shippingTotal: shippingTotal === null ? null : String(shippingTotal),
      discountTotal: String(discountTotal),
      grandTotal: grandTotal === null ? null : String(grandTotal),
      discount,
      needsAddress: !address,
      paymentMethods,
      excludedItems,
      blockingIssues,
      canPlaceOrder: blockingIssues.length === 0,
    };
  }

  private async createPayUrlSafely(
    method: PaymentMethod,
    created: {
      groupId: string;
      txnRef: string;
      amount: number;
      expiresAt: Date;
    },
  ): Promise<string | null> {
    const gateway = this.paymentGateway.getConfigured(method);
    if (!gateway) return null;
    try {
      const { payUrl } = await gateway.createPayment({
        txnRef: created.txnRef,
        amountVnd: created.amount,
        returnUrl: this.buildReturnUrl(method),
        expiresAt: created.expiresAt,
        locale: 'vi',
      });
      await this.prisma.payment.update({
        where: { txnRef: created.txnRef },
        data: { payUrl },
      });
      return payUrl;
    } catch (error) {
      this.logger.error(
        `Failed to create payment URL for txnRef=${created.txnRef} (group=${created.groupId})`,
        error instanceof Error ? error.stack : error,
      );
      return null;
    }
  }

  private buildReturnUrl(method: PaymentMethod): string {
    const base = (
      process.env.API_PUBLIC_URL?.trim() || 'http://localhost:4000'
    ).replace(/\/+$/, '');
    return `${base}/api/v1/payments/${method.toLowerCase()}/return`;
  }

  // Đơn "khả dụng" theo Week7.md 1.12: mọi dòng khả dụng của giỏ (dòng không khả dụng bị loại và
  // ở lại giỏ). Checkout chỉ đọc giỏ đã đăng nhập (1.2) nên `id` luôn là CartItem id thật.
  private extractPurchasableLines(cartView: CartView): AvailableLine[] {
    return cartView.shops.flatMap((shop) =>
      shop.items
        .filter((item) => item.isAvailable)
        .map((item) => ({
          cartItemId: item.id as string,
          productVariantId: item.productVariantId,
          quantity: item.quantity,
          shopId: shop.shopId,
          shopName: shop.shopName,
          shopSlug: shop.shopSlug,
        })),
    );
  }

  private async loadItemMetadata(
    tx: TxClient,
    variantIds: string[],
  ): Promise<Map<string, VariantMetadata>> {
    const rows = await tx.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        sku: true,
        weightGram: true,
        product: { select: { name: true } },
        images: {
          orderBy: { position: 'asc' },
          take: 1,
          select: { url: true },
        },
        attributeValues: {
          select: {
            attributeValue: {
              select: {
                value: true,
                attribute: { select: { position: true } },
              },
            },
          },
        },
      },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        {
          productName: row.product.name,
          sku: row.sku,
          weightGram: row.weightGram,
          imageUrl: row.images[0]?.url ?? null,
          variantLabel:
            row.attributeValues.length > 0
              ? [...row.attributeValues]
                  .sort(
                    (a, b) =>
                      a.attributeValue.attribute.position -
                      b.attributeValue.attribute.position,
                  )
                  .map((v) => v.attributeValue.value)
                  .join(' / ')
              : null,
        },
      ]),
    );
  }

  private buildShopsForPlan(
    lines: AvailableLine[],
    prices: Map<string, Prisma.Decimal>,
    metadata: Map<string, VariantMetadata>,
    originProvince: string,
  ): CheckoutPlanShop[] {
    const byShop = new Map<string, CheckoutPlanShop>();
    for (const line of lines) {
      let shop = byShop.get(line.shopId);
      if (!shop) {
        shop = {
          shopId: line.shopId,
          shopName: line.shopName,
          shopSlug: line.shopSlug,
          originProvince,
          items: [],
        };
        byShop.set(line.shopId, shop);
      }
      // price/meta chắc chắn có: line.productVariantId nằm trong chính danh sách đã reserve()/
      // loadItemMetadata() ở trên (cùng 1 tập variantIds).
      const price = prices.get(line.productVariantId)!;
      const meta = metadata.get(line.productVariantId)!;
      shop.items.push({
        cartItemId: line.cartItemId,
        productVariantId: line.productVariantId,
        productName: meta.productName,
        variantLabel: meta.variantLabel,
        sku: meta.sku,
        imageUrl: meta.imageUrl,
        quantity: line.quantity,
        unitPrice: price.toNumber(),
        weightGram: meta.weightGram,
      });
    }
    return [...byShop.values()];
  }

  // CartView tối giản chỉ đủ field VoucherService.validate() cần đọc (subtotal theo shop/tổng) —
  // dựng từ subtotal ĐÃ KHOÁ thay vì cart trước giao dịch, để số giảm tính trên giá thật lúc chốt.
  private buildSyntheticCartView(
    shopSubtotals: { shopId: string; subtotal: number }[],
  ): CartView {
    const total = shopSubtotals.reduce((sum, s) => sum + s.subtotal, 0);
    return {
      shops: shopSubtotals.map((s) => ({
        shopId: s.shopId,
        shopName: '',
        shopSlug: '',
        items: [],
        subtotal: String(s.subtotal),
      })),
      subtotal: String(total),
      discount: null,
      grandTotal: String(total),
      itemCount: 0,
    };
  }

  private countPendingGroups(
    client: Pick<TxClient, 'order'>,
    userId: string,
  ): Promise<string[]> {
    return client.order
      .findMany({
        where: { userId, status: 'AWAITING_PAYMENT' },
        distinct: ['checkoutGroupId'],
        select: { checkoutGroupId: true },
      })
      .then((rows) => rows.map((r) => r.checkoutGroupId));
  }

  private async findExistingResult(
    userId: string,
    idempotencyKey: string,
  ): Promise<PlaceOrderResult | null> {
    const group = await this.prisma.checkoutGroup.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      select: {
        id: true,
        orders: {
          select: { id: true, shopId: true, status: true, totalAmount: true },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { method: true, amount: true, expiresAt: true, payUrl: true },
        },
      },
    });
    if (!group) return null;

    const payment = group.payments[0];
    if (!payment) {
      // Không thể xảy ra qua đường placeOrder bình thường (luôn tạo đúng 1 Payment cùng lúc với
      // CheckoutGroup) — báo lỗi rõ thay vì trả dữ liệu bịa.
      throw new Error(`CheckoutGroup ${group.id} has no Payment`);
    }

    // COD (không cổng, không hết hạn) chưa đi qua placeOrder — phát lại kết quả COD làm ở Week8.md 2.7.
    if (payment.expiresAt === null) {
      throw new Error(`CheckoutGroup ${group.id} has a COD payment`);
    }

    return {
      checkoutGroupId: group.id,
      orders: group.orders.map((o) => ({
        id: o.id,
        shopId: o.shopId,
        status: o.status,
        totalAmount: o.totalAmount.toString(),
      })),
      totalAmount: payment.amount.toString(),
      paymentMethod: payment.method,
      expiresAt: payment.expiresAt.toISOString(),
      paymentUrl: payment.payUrl,
    };
  }

  private isCartChanged(error: unknown): boolean {
    return error instanceof AppException && error.code === 'CART_CHANGED';
  }

  // Soi error.meta theo rules/backend.md mục 4 — transaction này ghi vào ≥ 2 model có unique riêng
  // (CheckoutGroup, Payment.txnRef, VoucherUsage). `target` là cách kiểm chứng được xác nhận qua
  // Prisma + Postgres (xem address.int-spec.ts); `modelName` dùng thêm nếu Prisma cung cấp.
  private isCheckoutGroupP2002(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }
    const meta = error.meta as
      { modelName?: string; target?: string | string[] } | undefined;
    if (meta?.modelName === 'CheckoutGroup') return true;
    const target = meta?.target;
    const targetText = Array.isArray(target)
      ? target.join(',')
      : (target ?? '');
    return targetText.includes('idempotency_key');
  }
}
