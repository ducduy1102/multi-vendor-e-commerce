import {
  PrismaClient,
  type OrderStatus,
  type PaymentMethod,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { createFakeMail } from '../../shared/testing/fake-mail';
import {
  cleanupByTag,
  createCheckoutGroup,
  createShopWithProduct,
  createUser,
  createVariant,
} from '../../shared/testing/db-fixtures';
import { OrderEmailService } from './order-email.service';

// Integration test (Postgres thật + MailProvider giả) cho OrderEmailService (Week8.md 2.8): đọc đúng dữ
// liệu thật từ DB (tên/email buyer, shop, dòng hàng, địa chỉ, phương thức thanh toán, vận chuyển), email
// ra đúng người nhận/nội dung, dữ liệu do người dùng nhập được escape, và mail lỗi không bao giờ ném.
// Chạy: `pnpm test:int`.
const TAG = 'it-order-email-';

describe('OrderEmailService (DB thật)', () => {
  const prisma = new PrismaClient();
  const fakeMail = createFakeMail();
  const service = new OrderEmailService(
    prisma as unknown as PrismaService,
    fakeMail.mailService,
  );

  beforeAll(() => cleanupByTag(prisma, TAG));
  beforeEach(() => fakeMail.reset());
  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  // 1 nhóm có `lines` đơn (mỗi đơn 1 shop riêng), 1 Payment theo `method`.
  async function seedGroup(
    status: OrderStatus,
    method: PaymentMethod,
    shopCount = 1,
    extra: { carrier?: string; trackingCode?: string; shopName?: string } = {},
  ) {
    const user = await prisma.user.update({
      where: { id: (await createUser(prisma, TAG)).id },
      data: { name: 'Nguyễn Văn A' },
      select: { id: true, email: true },
    });
    const group = await createCheckoutGroup(prisma, user.id);
    const orderIds: string[] = [];
    for (let i = 0; i < shopCount; i++) {
      const base = await createShopWithProduct(prisma, TAG);
      if (extra.shopName) {
        await prisma.shop.update({
          where: { id: base.shopId },
          data: { name: extra.shopName },
        });
      }
      const variant = await createVariant(prisma, base, { stock: 10 });
      const order = await prisma.order.create({
        data: {
          userId: user.id,
          shopId: base.shopId,
          checkoutGroupId: group.id,
          status,
          totalAmount: 220_000,
          shippingFee: 20_000,
          discountAmount: 10_000,
          carrier: extra.carrier,
          trackingCode: extra.trackingCode,
          recipientName: 'Trần Thị B',
          recipientPhone: '0912345678',
          shippingAddressLine: '12 Nguyễn Huệ',
          shippingWard: 'Phường Bến Nghé',
          shippingProvince: 'Hồ Chí Minh',
          items: {
            create: [
              {
                productVariantId: variant.id,
                quantity: 2,
                priceAtPurchase: 100_000,
                productName: 'Áo thun cotton',
                variantLabel: 'Đỏ / M',
                sku: `SKU-${i}-${Date.now()}`,
                imageUrl: null,
              },
            ],
          },
        },
        select: { id: true },
      });
      orderIds.push(order.id);
    }
    await prisma.payment.create({
      data: {
        checkoutGroupId: group.id,
        method,
        status: method === 'COD' ? 'PENDING' : 'SUCCESS',
        amount: 220_000 * shopCount,
        txnRef: `${TAG.toUpperCase()}${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        expiresAt: method === 'COD' ? null : new Date(Date.now() + 60_000),
      },
    });
    return { user, groupId: group.id, orderIds };
  }

  it('notifyPlaced đơn COD (2 shop): 1 email gộp tới đúng buyer, nói "thanh toán khi nhận hàng", có đủ 2 shop, địa chỉ và link', async () => {
    const { user, groupId } = await seedGroup('PENDING', 'COD', 2);

    await service.notifyPlaced(groupId);

    expect(fakeMail.sent).toHaveLength(1);
    const [mail] = fakeMail.sent;
    expect(mail.to).toBe(user.email);
    expect(mail.subject).toBe('Đặt hàng thành công — thanh toán khi nhận hàng');
    const text = mail.html.replace(/\s/g, ' ');
    expect(text).toContain('Chào Nguyễn Văn A');
    expect(text).toContain('Áo thun cotton (Đỏ / M) × 2');
    expect(text).toContain('Trần Thị B');
    expect(text).toContain('12 Nguyễn Huệ, Phường Bến Nghé, Hồ Chí Minh');
    expect(text).toContain('440.000 ₫'); // 2 đơn × 220.000
    expect((text.match(/Mã đơn #/g) ?? []).length).toBe(2);
  });

  it('notifyPlaced đơn đã thanh toán online: tiêu đề "thanh toán thành công"', async () => {
    const { groupId } = await seedGroup('PENDING', 'VNPAY');

    await service.notifyPlaced(groupId);

    expect(fakeMail.sent[0].subject).toBe(
      'Thanh toán thành công — đơn hàng đang chờ shop xác nhận',
    );
  });

  it('notifyConfirmed: tiêu đề có tên shop thật, link trỏ thẳng tới đơn', async () => {
    const { orderIds } = await seedGroup('CONFIRMED', 'VNPAY', 1, {
      shopName: 'Shop Áo Xinh',
    });

    await service.notifyConfirmed(orderIds[0]);

    expect(fakeMail.sent).toHaveLength(1);
    expect(fakeMail.sent[0].subject).toBe(
      'Shop Áo Xinh đã xác nhận đơn hàng của bạn',
    );
    expect(fakeMail.sent[0].html).toContain(`/orders/${orderIds[0]}`);
  });

  it('notifyShipped: mang theo đơn vị vận chuyển và mã vận đơn đã lưu trong DB', async () => {
    const { orderIds } = await seedGroup('SHIPPING', 'VNPAY', 1, {
      carrier: 'GHN',
      trackingCode: 'GHN123456',
    });

    await service.notifyShipped(orderIds[0]);

    const { subject, html } = fakeMail.sent[0];
    expect(subject).toBe('Đơn hàng của bạn đang được giao');
    expect(html).toContain('<strong>GHN</strong>');
    expect(html).toContain('<strong>GHN123456</strong>');
  });

  it('notifyCancelled theo đơn: CHỈ gửi cho đơn đã CANCELLED; đơn chưa hủy bị bỏ qua', async () => {
    const live = await seedGroup('PENDING', 'COD');
    const cancelled = await seedGroup('CANCELLED', 'COD');

    await service.notifyCancelled(
      { orderIds: [live.orderIds[0]] },
      'SELLER',
      'x',
    );
    expect(fakeMail.sent).toHaveLength(0);

    await service.notifyCancelled(
      { orderIds: [cancelled.orderIds[0]] },
      'SELLER',
      'Hết hàng',
    );
    expect(fakeMail.sent).toHaveLength(1);
    expect(fakeMail.sent[0].subject).toBe(
      'Đơn hàng của bạn đã bị shop từ chối',
    );
    expect(fakeMail.sent[0].html).toContain('Hết hàng');
  });

  it('notifyCancelled theo nhóm: 1 email gộp mọi đơn đã hủy của nhóm', async () => {
    const { groupId } = await seedGroup('CANCELLED', 'VNPAY', 2);

    await service.notifyCancelled({ checkoutGroupId: groupId }, 'SYSTEM');

    expect(fakeMail.sent).toHaveLength(1);
    expect(fakeMail.sent[0].subject).toBe(
      'Đơn hàng đã bị hủy do hết hạn thanh toán',
    );
    expect((fakeMail.sent[0].html.match(/Mã đơn #/g) ?? []).length).toBe(2);
  });

  it('lý do từ chối do seller nhập chứa HTML — email gửi buyer đã escape, không chèn được link/thẻ', async () => {
    const { orderIds } = await seedGroup('CANCELLED', 'COD');

    await service.notifyCancelled(
      { orderIds },
      'SELLER',
      '<a href="https://evil.example">Nhập mật khẩu</a><script>x()</script>',
    );

    const { html } = fakeMail.sent[0];
    expect(html).not.toContain('href="https://evil.example"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('tên shop/sản phẩm chứa HTML (dữ liệu seller nhập) cũng được escape', async () => {
    const { orderIds } = await seedGroup('CONFIRMED', 'VNPAY', 1, {
      shopName: '<img src=x onerror=alert(1)>',
    });

    await service.notifyConfirmed(orderIds[0]);

    expect(fakeMail.sent[0].html).not.toContain('<img src=x');
    expect(fakeMail.sent[0].html).toContain('&lt;img');
  });

  it('provider mail lỗi — KHÔNG ném (DB đã commit, chỉ log)', async () => {
    const { groupId, orderIds } = await seedGroup('PENDING', 'COD');
    fakeMail.failWith(new Error('Resend down'));

    await expect(service.notifyPlaced(groupId)).resolves.toBeUndefined();
    await expect(service.notifyConfirmed(orderIds[0])).resolves.toBeUndefined();
    await expect(service.notifyShipped(orderIds[0])).resolves.toBeUndefined();
    await expect(
      service.notifyCancelled({ orderIds }, 'BUYER'),
    ).resolves.toBeUndefined();
    expect(fakeMail.sent).toHaveLength(0);
  });

  it('id không tồn tại — không gửi gì, không lỗi', async () => {
    await service.notifyPlaced('khong-co-nhom');
    await service.notifyConfirmed('khong-co-don');
    await service.notifyShipped('khong-co-don');
    await service.notifyCancelled({ orderIds: ['khong-co-don'] }, 'BUYER');

    expect(fakeMail.sent).toHaveLength(0);
  });
});
