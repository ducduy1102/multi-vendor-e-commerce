import { PrismaClient, type OrderStatus } from '@prisma/client';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { NotificationFactsLoader } from '../../shared/notification/notification-facts.loader';
import {
  cleanupByTag,
  createCheckoutGroup,
  createShopWithProduct,
  createUser,
  createVariant,
  seedOrderHistory,
} from '../../shared/testing/db-fixtures';
import { sellerVisibleOrderFilter } from './seller-order-visibility';

// Khoá cho luật "chủ shop đã từng thấy đơn này chưa" (Week10.md 7.3). Luật này có MỘT định nghĩa gốc ở modules/order
// (`sellerVisibleOrderFilter`: trạng thái hiện tại không phải AWAITING_PAYMENT VÀ đơn từng ở PENDING) và một bản lặp lại
// ở shared/notification (đơn có dòng lịch sử toStatus = PENDING) vì shared/ không được import modules/. Hai bản phải cho
// CÙNG kết quả với mọi trạng thái đơn có thể đạt tới — nếu ai đó đổi luật hiển thị cho Seller mà quên bản thông báo, thông
// báo sẽ lộ đơn mà shop không được thấy (hoặc ngược lại) và test này đỏ.
// Chạy: `pnpm test:int`.
const TAG = 'it-seller-visibility-';

describe('luật "shop đã thấy đơn" khớp giữa sellerVisibleOrderFilter và bộ tải dữ kiện thông báo (DB thật)', () => {
  const prisma = new PrismaClient();
  const loader = new NotificationFactsLoader(
    prisma as unknown as PrismaService,
  );
  let buyerId: string;
  let shopId: string;
  let variantId: string;

  async function orderIn(status: OrderStatus, isCod: boolean) {
    const group = await createCheckoutGroup(prisma, buyerId);
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { sku: true, price: true },
    });
    return prisma.order.create({
      data: {
        userId: buyerId,
        shopId,
        checkoutGroupId: group.id,
        status,
        totalAmount: variant.price,
        recipientName: 'Nguyễn Văn A',
        recipientPhone: '0912345678',
        shippingAddressLine: '12 Nguyễn Huệ',
        shippingWard: 'Phường Bến Nghé',
        shippingProvince: 'Hồ Chí Minh',
        items: {
          create: [
            {
              productVariantId: variantId,
              quantity: 1,
              priceAtPurchase: variant.price,
              productName: 'sp',
              sku: variant.sku,
              variantLabel: null,
              imageUrl: null,
            },
          ],
        },
        statusHistory: { create: seedOrderHistory(status, { isCod }) },
      },
      select: { id: true },
    });
  }

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    const shop = await createShopWithProduct(prisma, TAG);
    shopId = shop.shopId;
    variantId = (await createVariant(prisma, shop, { stock: 50 })).id;
    buyerId = (await createUser(prisma, TAG)).id;
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  // Mọi (trạng thái, phương thức) mà luồng thật có thể tạo ra; kỳ vọng ghi tường minh để bảng này tự là tài liệu.
  const CASES: Array<[OrderStatus, boolean, boolean]> = [
    // [trạng thái, COD, shop đã thấy]
    ['AWAITING_PAYMENT', false, false],
    ['PENDING', true, true],
    ['PENDING', false, true],
    ['CONFIRMED', true, true],
    ['CONFIRMED', false, true],
    ['PACKED', true, true],
    ['SHIPPING', false, true],
    ['COMPLETED', true, true],
    ['COMPLETED', false, true],
    ['CANCELLED', true, true], // COD: đã đặt (PENDING) rồi mới hủy ⇒ shop từng thấy
    ['CANCELLED', false, false], // online chưa từng thanh toán ⇒ shop chưa bao giờ thấy
  ];

  it.each(CASES)(
    'đơn %s (COD=%s): cả hai bản luật cùng kết luận shop đã thấy = %s',
    async (status, isCod, expected) => {
      const { id } = await orderIn(status, isCod);

      const byFilter =
        (await prisma.order.count({
          where: { id, ...sellerVisibleOrderFilter() },
        })) > 0;
      const facts = await loader.load({
        kind: 'ORDER_CONFIRMED',
        orderId: id,
      });
      const byLoader =
        facts?.kind === 'ORDERS' ? facts.orders[0].visibleToSeller : null;

      expect(byFilter).toBe(expected);
      expect(byLoader).toBe(expected);
    },
  );
});
