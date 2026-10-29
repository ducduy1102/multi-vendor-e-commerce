import { INestApplication, Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  Prisma,
  PrismaClient,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type ShopStatus,
} from '@prisma/client';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  ORDER_INTERNAL_NOTE_MAX_LENGTH,
  sellerOrderDetailSchema,
  sellerOrderListResponseSchema,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  cleanupByTag,
  createCheckoutGroup,
  createShopWithProduct,
  createVariant,
  seedOrderHistory,
} from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';
import { seedAdmin } from '../../../prisma/seed-admin';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho PATCH /shops/:shopId/orders/:orderId/internal-note (Week11.md 4.4).
// Chứng minh điều unit test với mock không chứng minh được: quyền (401/403/404), validate, phạm vi (đơn của shop khác, đơn chưa thanh
// toán, id sai dạng cùng ra một 404), đặt/sửa/xoá và lưu NULL thay vì chuỗi rỗng, ghi ở mọi trạng thái nhìn thấy được mà không đổi
// trạng thái đơn, CHECK ở DB, ghi chú KHÔNG lọt ra bất kỳ route/email/thông báo nào của người mua hay Admin, và nội dung ghi chú
// không vào log kể cả khi ghi lỗi. Chạy: `pnpm test:int`.
const TAG = 'it-order-note-';
const PASSWORD = 'password123';

interface SeedOrder {
  shopId: string;
  status: OrderStatus;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
}

const fakeMail = createFakeMail();

describe('Ghi chú nội bộ của shop trên đơn (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  let sellerA: Agent;
  let sellerB: Agent;
  let sellerSuspended: Agent;
  let buyer: Agent;
  let admin: Agent;
  let anonymous: Agent;
  let buyerId: string;
  let shopA: string;
  let shopB: string;
  let shopSuspended: string;
  const observed = new Set<number>();

  const data = (res: { body: unknown }) => (res.body as { data: unknown }).data;
  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;
  const url = (shopId: string, orderId: string) =>
    `/api/v1/shops/${shopId}/orders/${orderId}/internal-note`;

  async function registerAndLogin(suffix: string) {
    const agent = newAgent();
    const email = `${TAG}${stamp}${suffix}@test.local`;
    await agent
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, name: `${TAG}${suffix}` })
      .expect(201);
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    return { agent, userId: user.id, email };
  }

  async function createShopFor(
    ownerId: string,
    suffix: string,
    status: ShopStatus,
  ) {
    const shop = await prisma.shop.create({
      data: {
        ownerId,
        name: `${TAG}shop-${suffix}`,
        slug: `${TAG}shop-${suffix}-${stamp}`,
        status,
      },
      select: { id: true },
    });
    return shop.id;
  }

  async function seedOrder(input: SeedOrder) {
    const group = await createCheckoutGroup(prisma, buyerId);
    const base = await createShopWithProduct(prisma, TAG);
    const variant = await createVariant(prisma, base, { stock: 100 });
    const method = input.paymentMethod ?? 'VNPAY';
    const order = await prisma.order.create({
      data: {
        userId: buyerId,
        shopId: input.shopId,
        checkoutGroupId: group.id,
        status: input.status,
        totalAmount: 220_000,
        shippingFee: 20_000,
        recipientName: 'Nguyễn Văn A',
        recipientPhone: '0912345678',
        shippingAddressLine: '12 Nguyễn Huệ',
        shippingWard: 'Phường Bến Nghé',
        shippingProvince: 'Hồ Chí Minh',
        items: {
          create: [
            {
              productVariantId: variant.id,
              quantity: 1,
              priceAtPurchase: 100_000,
              productName: `${TAG}sp`,
              sku: `SKU-${stamp}-${randomUUID().slice(0, 6)}`,
              variantLabel: null,
              imageUrl: null,
            },
          ],
        },
        statusHistory: {
          create: seedOrderHistory(input.status, {
            isCod: method === 'COD',
          }).map((row) => ({
            ...row,
            actorId: row.actorType === 'BUYER' ? buyerId : undefined,
          })),
        },
      },
      select: { id: true },
    });
    await prisma.payment.create({
      data: {
        checkoutGroupId: group.id,
        method,
        status: input.paymentStatus ?? 'SUCCESS',
        amount: 220_000,
        txnRef: `${TAG.toUpperCase()}${stamp}${order.id.slice(0, 8)}`,
        expiresAt: method === 'COD' ? null : new Date(Date.now() + 15 * 60_000),
      },
    });
    return { orderId: order.id, groupId: group.id };
  }

  const noteOf = async (orderId: string) =>
    (
      await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { internalNote: true },
      })
    ).internalNote;
  const stateOf = async (orderId: string) => {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        status: true,
        totalAmount: true,
        _count: { select: { statusHistory: true } },
      },
    });
    return {
      status: order.status,
      total: order.totalAmount.toString(),
      history: order._count.statusHistory,
    };
  };

  async function setNote(
    agent: Agent,
    shopId: string,
    orderId: string,
    body: unknown = {},
  ) {
    const res = await agent.patch(url(shopId, orderId)).send(body as object);
    observed.add(res.status);
    return res;
  }

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(fakeMail.provider)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    // Nghe MỘT LẦN trên cổng ngẫu nhiên (rules/backend.md mục 7): tránh ECONNRESET khi có request song song.
    await app.listen(0);

    const a = await registerAndLogin('a');
    const b = await registerAndLogin('b');
    const s = await registerAndLogin('s');
    const buyerAccount = await registerAndLogin('buyer');
    sellerA = a.agent;
    sellerB = b.agent;
    sellerSuspended = s.agent;
    buyer = buyerAccount.agent;
    buyerId = buyerAccount.userId;
    shopA = await createShopFor(a.userId, 'a', 'APPROVED');
    shopB = await createShopFor(b.userId, 'b', 'APPROVED');
    shopSuspended = await createShopFor(s.userId, 's', 'SUSPENDED');

    const adminEmail = `${TAG}${stamp}admin@test.local`;
    await seedAdmin(prisma, { email: adminEmail, password: PASSWORD });
    admin = newAgent();
    await admin
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: PASSWORD })
      .expect(200);
    anonymous = newAgent();
  });

  afterEach(() => {
    fakeMail.reset();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  describe('quyền và dữ liệu vào', () => {
    it('chưa đăng nhập 401; seller khác 403; người mua thường (không có shop) 403; shop không tồn tại 404 — và ghi chú không đổi', async () => {
      const { orderId } = await seedOrder({ shopId: shopA, status: 'PENDING' });
      const body = { note: 'x' };

      expect((await setNote(anonymous, shopA, orderId, body)).status).toBe(401);
      expect((await setNote(sellerB, shopA, orderId, body)).status).toBe(403);
      expect((await setNote(buyer, shopA, orderId, body)).status).toBe(403);
      expect(
        (await setNote(sellerA, 'khong-ton-tai', orderId, body)).status,
      ).toBe(404);

      expect(await noteOf(orderId)).toBeNull();
    });

    it.each([
      ['thiếu note (body rỗng)', {}],
      ['note không phải chuỗi', { note: 5 }],
      ['note là object', { note: { text: 'x' } }],
      ['note undefined', { note: undefined }],
      [
        'quá 500 ký tự',
        { note: 'a'.repeat(ORDER_INTERNAL_NOTE_MAX_LENGTH + 1) },
      ],
      ['có NUL', { note: 'abc\u0000def' }],
      ['có tab', { note: 'abc\tdef' }],
      ['có ký tự bidi-override', { note: 'abc‮def' }],
    ])('%s ⇒ 400 và ghi chú cũ giữ nguyên', async (_name, body) => {
      const { orderId } = await seedOrder({ shopId: shopA, status: 'PENDING' });
      await setNote(sellerA, shopA, orderId, { note: 'ghi chú cũ' }).then(
        (res) => expect(res.status).toBe(200),
      );

      const res = await setNote(sellerA, shopA, orderId, body);

      expect(res.status).toBe(400);
      expect(await noteOf(orderId)).toBe('ghi chú cũ');
    });

    it('không gửi body nào cũng là 400 chứ không phải 500 (và không xoá ghi chú)', async () => {
      const { orderId } = await seedOrder({ shopId: shopA, status: 'PENDING' });
      await setNote(sellerA, shopA, orderId, { note: 'giữ lại' });

      const res = await sellerA.patch(url(shopA, orderId));
      observed.add(res.status);

      expect(res.status).toBe(400);
      expect(await noteOf(orderId)).toBe('giữ lại');
    });
  });

  describe('đặt, sửa, xoá', () => {
    it('đặt ghi chú: 200 kèm chi tiết đơn mới nhất (parse được bằng schema dùng chung), nội dung được chuẩn hoá, đọc lại ở chi tiết', async () => {
      const { orderId } = await seedOrder({ shopId: shopA, status: 'PENDING' });

      const res = await setNote(sellerA, shopA, orderId, {
        note: '  Đã gọi khách\r\nBọc kỹ  ',
      });

      expect(res.status).toBe(200);
      // Dữ liệu riêng tư (SĐT, địa chỉ, ghi chú nội bộ): không để trình duyệt/proxy lưu bản sao.
      expect(res.headers['cache-control']).toBe('no-store');
      const detail = sellerOrderDetailSchema.parse(data(res));
      expect(detail.id).toBe(orderId);
      expect(detail.internalNote).toBe('Đã gọi khách\nBọc kỹ');
      expect(await noteOf(orderId)).toBe('Đã gọi khách\nBọc kỹ');
      const detailRes = await sellerA.get(
        `/api/v1/shops/${shopA}/orders/${orderId}`,
      );
      expect(detailRes.headers['cache-control']).toBe('no-store');
      const again = sellerOrderDetailSchema.parse(data(detailRes));
      expect(again.internalNote).toBe('Đã gọi khách\nBọc kỹ');
    });

    it('đơn chưa có ghi chú ⇒ internalNote null ở chi tiết', async () => {
      const { orderId } = await seedOrder({ shopId: shopA, status: 'PENDING' });

      const detail = sellerOrderDetailSchema.parse(
        data(await sellerA.get(`/api/v1/shops/${shopA}/orders/${orderId}`)),
      );

      expect(detail.internalNote).toBeNull();
    });

    it('sửa: thay HẲN ghi chú cũ; có thể sửa nhiều lần', async () => {
      const { orderId } = await seedOrder({
        shopId: shopA,
        status: 'CONFIRMED',
      });

      await setNote(sellerA, shopA, orderId, { note: 'bản một' });
      await setNote(sellerA, shopA, orderId, { note: 'bản hai' });
      const res = await setNote(sellerA, shopA, orderId, { note: 'bản ba' });

      expect(sellerOrderDetailSchema.parse(data(res)).internalNote).toBe(
        'bản ba',
      );
      expect(await noteOf(orderId)).toBe('bản ba');
    });

    it.each([
      ['chuỗi rỗng', ''],
      ['chỉ khoảng trắng', '   \n  '],
      ['null', null],
    ])(
      'xoá bằng %s ⇒ lưu NULL (KHÔNG bao giờ lưu chuỗi rỗng)',
      async (_name, note) => {
        const { orderId } = await seedOrder({
          shopId: shopA,
          status: 'PENDING',
        });
        await setNote(sellerA, shopA, orderId, { note: 'sẽ bị xoá' });

        const res = await setNote(sellerA, shopA, orderId, { note });

        expect(res.status).toBe(200);
        expect(
          sellerOrderDetailSchema.parse(data(res)).internalNote,
        ).toBeNull();
        expect(await noteOf(orderId)).toBeNull();
      },
    );

    it('xoá khi chưa có ghi chú nào vẫn 200 (idempotent)', async () => {
      const { orderId } = await seedOrder({ shopId: shopA, status: 'PENDING' });

      const res = await setNote(sellerA, shopA, orderId, { note: '' });

      expect(res.status).toBe(200);
      expect(await noteOf(orderId)).toBeNull();
    });

    it('đúng cận 500 ký tự (cả emoji nhiều đơn vị) được ghi nguyên vẹn; chữ như <img onerror>, {code}, ${x} được trả NGUYÊN VĂN', async () => {
      const { orderId } = await seedOrder({ shopId: shopA, status: 'PENDING' });
      const max = '😀'.repeat(ORDER_INTERNAL_NOTE_MAX_LENGTH / 2);

      expect(
        (await setNote(sellerA, shopA, orderId, { note: max })).status,
      ).toBe(200);
      expect(await noteOf(orderId)).toBe(max);

      const text = '<img src=x onerror=alert(1)> {code} ${x}';
      const res = await setNote(sellerA, shopA, orderId, { note: text });
      expect(sellerOrderDetailSchema.parse(data(res)).internalNote).toBe(text);
    });

    it('ghi chú KHÔNG đổi trạng thái, tiền hay lịch sử của đơn', async () => {
      const { orderId } = await seedOrder({
        shopId: shopA,
        status: 'CONFIRMED',
      });
      const before = await stateOf(orderId);

      await setNote(sellerA, shopA, orderId, { note: 'chỉ là ghi chú' });

      expect(await stateOf(orderId)).toEqual(before);
    });

    it.each([
      ['PENDING', {}],
      ['CONFIRMED', {}],
      ['PACKED', {}],
      ['SHIPPING', {}],
      ['COMPLETED', {}],
      ['CANCELLED', { paymentMethod: 'COD', paymentStatus: 'PENDING' }],
    ] as const)(
      'ghi được ở đơn %s (kể cả đã đóng — shop vẫn cần ghi chú về nó)',
      async (status, extra) => {
        const { orderId } = await seedOrder({
          shopId: shopA,
          status,
          ...extra,
        });

        const res = await setNote(sellerA, shopA, orderId, {
          note: `ghi chú ${status}`,
        });

        expect(res.status).toBe(200);
        expect(await noteOf(orderId)).toBe(`ghi chú ${status}`);
        expect((await stateOf(orderId)).status).toBe(status);
      },
    );

    it('shop đang bị khoá (SUSPENDED) vẫn ghi chú được đơn đã có', async () => {
      const { orderId } = await seedOrder({
        shopId: shopSuspended,
        status: 'CONFIRMED',
      });

      const res = await setNote(sellerSuspended, shopSuspended, orderId, {
        note: 'đơn của shop đang bị khoá',
      });

      expect(res.status).toBe(200);
      expect(await noteOf(orderId)).toBe('đơn của shop đang bị khoá');
    });
  });

  describe('phạm vi: không ghi được lên đơn không phải của mình', () => {
    it('đơn của shop KHÁC (đi qua shop của mình hoặc shop đó) ⇒ không đổi gì', async () => {
      const own = await seedOrder({ shopId: shopA, status: 'PENDING' });
      const theirs = await seedOrder({ shopId: shopB, status: 'PENDING' });

      // sellerA dùng shop của mình nhưng trỏ tới đơn của shop B ⇒ 404 (không phân biệt với đơn không tồn tại).
      const viaOwnShop = await setNote(sellerA, shopA, theirs.orderId, {
        note: 'xâm nhập',
      });
      // sellerA dùng shop của shop B ⇒ 403 ở ShopOwnerGuard.
      const viaOtherShop = await setNote(sellerA, shopB, theirs.orderId, {
        note: 'xâm nhập',
      });
      // sellerB dùng shop của mình nhưng trỏ tới đơn của shop A ⇒ 404.
      const reverse = await setNote(sellerB, shopB, own.orderId, {
        note: 'xâm nhập',
      });

      expect(viaOwnShop.status).toBe(404);
      expect(code(viaOwnShop)).toBe('ORDER_NOT_FOUND');
      expect(viaOtherShop.status).toBe(403);
      expect(reverse.status).toBe(404);
      expect(await noteOf(theirs.orderId)).toBeNull();
      expect(await noteOf(own.orderId)).toBeNull();
    });

    it('đơn AWAITING_PAYMENT và đơn CHƯA TỪNG thanh toán rồi bị hủy: cùng 404, không ghi được và không lộ là có tồn tại', async () => {
      const unpaid = await seedOrder({
        shopId: shopA,
        status: 'AWAITING_PAYMENT',
        paymentStatus: 'PENDING',
      });
      const neverPaid = await seedOrder({
        shopId: shopA,
        status: 'CANCELLED',
        paymentStatus: 'FAILED',
      });
      const missing = randomUUID();

      const responses = [
        await setNote(sellerA, shopA, unpaid.orderId, { note: 'x' }),
        await setNote(sellerA, shopA, neverPaid.orderId, { note: 'x' }),
        await setNote(sellerA, shopA, missing, { note: 'x' }),
      ];

      // Cùng status, cùng mã, cùng thân — so cả thân để không có "oracle" dò đơn chưa thanh toán.
      expect(responses.map((res) => res.status)).toEqual([404, 404, 404]);
      expect(
        new Set(responses.map((res) => JSON.stringify(res.body))).size,
      ).toBe(1);
      expect(code(responses[0])).toBe('ORDER_NOT_FOUND');
      expect(await noteOf(unpaid.orderId)).toBeNull();
      expect(await noteOf(neverPaid.orderId)).toBeNull();
    });

    it('id đơn sai dạng (chuỗi rác, có NUL, đường dẫn) ⇒ 404 chứ không 500', async () => {
      for (const orderId of ['not-a-uuid', '..%2F..%2Fetc', 'x%00y', '1']) {
        const res = await setNote(sellerA, shopA, orderId, { note: 'x' });
        expect([orderId, res.status]).toEqual([orderId, 404]);
      }
    });
  });

  describe('ràng buộc ngay ở DB', () => {
    it('CHECK chặn chuỗi rỗng; cột VARCHAR(500) chặn quá dài — kể cả khi vòng qua Zod bằng SQL thô', async () => {
      const { orderId } = await seedOrder({ shopId: shopA, status: 'PENDING' });

      await expect(
        prisma.$executeRaw`UPDATE orders SET internal_note = '' WHERE id = ${orderId}`,
      ).rejects.toThrow(/orders_internal_note_length_in_range/);
      await expect(
        prisma.$executeRaw`UPDATE orders SET internal_note = ${'a'.repeat(ORDER_INTERNAL_NOTE_MAX_LENGTH + 1)} WHERE id = ${orderId}`,
      ).rejects.toThrow(/value too long|22001/);
      await expect(
        prisma.$executeRaw`UPDATE orders SET internal_note = ${'a'.repeat(ORDER_INTERNAL_NOTE_MAX_LENGTH)} WHERE id = ${orderId}`,
      ).resolves.toBe(1);
    });
  });

  describe('ghi chú không bao giờ lọt ra ngoài chi tiết đơn của Seller', () => {
    it('người mua (danh sách, chi tiết, trạng thái nhóm, thông báo), danh sách đơn và hàng chờ yêu cầu của Seller, mọi màn hoàn tiền của Admin KHÔNG có nội dung ghi chú; email gửi người mua cũng không', async () => {
      const canary = `CANARY-NOTE-${randomUUID()}`;
      const { orderId, groupId } = await seedOrder({
        shopId: shopA,
        status: 'PENDING',
      });
      // Đơn có yêu cầu hủy đã lên sàn (ESCALATED): xuất hiện ở hàng chờ của Seller VÀ ở màn của Admin.
      await prisma.refundRequest.create({
        data: {
          orderId,
          shopId: shopA,
          userId: buyerId,
          kind: 'CANCEL',
          status: 'ESCALATED',
          reasonCode: 'CHANGE_OF_MIND',
          reasonNote: 'Đổi ý',
          sellerRespondBy: new Date(Date.now() + 24 * 3600_000),
          history: {
            create: [
              {
                fromStatus: null,
                toStatus: 'PENDING_SELLER',
                actorType: 'BUYER',
                actorId: buyerId,
              },
            ],
          },
        },
        select: { id: true },
      });

      const set = await setNote(sellerA, shopA, orderId, {
        note: `${canary} nội bộ`,
      });
      expect(set.status).toBe(200);

      const responses: Record<string, request.Response> = {
        'seller: chi tiết (đối chứng dương)': await sellerA.get(
          `/api/v1/shops/${shopA}/orders/${orderId}`,
        ),
        'seller: danh sách đơn': await sellerA.get(
          `/api/v1/shops/${shopA}/orders?limit=50`,
        ),
        'seller: hàng chờ yêu cầu': await sellerA.get(
          `/api/v1/shops/${shopA}/refund-requests?limit=50`,
        ),
        'buyer: danh sách đơn': await buyer.get('/api/v1/orders?limit=50'),
        'buyer: chi tiết đơn': await buyer.get(`/api/v1/orders/${orderId}`),
        'buyer: trạng thái nhóm': await buyer.get(
          `/api/v1/checkout/groups/${groupId}`,
        ),
        'buyer: thông báo': await buyer.get('/api/v1/notifications'),
        'admin: yêu cầu hủy/trả (ESCALATED)': await admin.get(
          '/api/v1/admin/refund-requests?status=ESCALATED',
        ),
        'admin: sổ hoàn tiền': await admin.get('/api/v1/admin/refunds'),
        'admin: thanh toán bất thường': await admin.get(
          '/api/v1/admin/refundable-payments',
        ),
      };

      for (const [name, res] of Object.entries(responses)) {
        expect([name, res.status]).toEqual([name, 200]);
        const leaks = JSON.stringify(res.body).includes(canary);
        // Chỉ chi tiết đơn của Seller (đối chứng dương) mang ghi chú.
        expect([name, leaks]).toEqual([
          name,
          name.startsWith('seller: chi tiết'),
        ]);
      }
      // Phòng quét rỗng: các màn của Admin/hàng chờ thật sự có dữ liệu của đơn này.
      expect(
        JSON.stringify(responses['seller: hàng chờ yêu cầu'].body),
      ).toContain(orderId);
      expect(
        JSON.stringify(responses['admin: yêu cầu hủy/trả (ESCALATED)'].body),
      ).toContain(orderId);

      // Hành động thật của Seller (từ chối đơn) sinh email cho người mua: không email nào được chứa ghi chú nội bộ.
      await sellerA
        .post(`/api/v1/shops/${shopA}/orders/${orderId}/reject`)
        .send({
          reason: 'Hết hàng',
        });
      const emails = fakeMail.sent;
      expect(emails.length).toBeGreaterThan(0);
      for (const email of emails) {
        expect(`${email.subject}\n${email.html}`).not.toContain(canary);
      }
    });
  });

  describe('log không bao giờ chứa nội dung ghi chú', () => {
    it('quét MỌI đường ghi log (Logger + stdout/stderr) trong cả luồng thường lẫn khi ghi lỗi', async () => {
      const canary = `CANARY-${randomUUID()}`;
      const { orderId } = await seedOrder({ shopId: shopA, status: 'PENDING' });
      const captured: string[] = [];
      const restores: (() => void)[] = [];
      const capture = (chunk: unknown) => {
        captured.push(
          typeof chunk === 'string' ? chunk : JSON.stringify(chunk),
        );
      };
      for (const stream of [process.stdout, process.stderr]) {
        const spy = jest
          .spyOn(stream, 'write')
          .mockImplementation((chunk: unknown) => {
            capture(chunk);
            return true;
          });
        restores.push(() => spy.mockRestore());
      }
      for (const level of [
        'log',
        'error',
        'warn',
        'debug',
        'verbose',
        'fatal',
      ] as const) {
        const spy = jest
          .spyOn(Logger.prototype, level)
          .mockImplementation((...args: unknown[]) => {
            capture(args);
          });
        restores.push(() => spy.mockRestore());
      }
      const prismaService = app.get(PrismaService);
      const write = (note: string) =>
        sellerA.patch(url(shopA, orderId)).send({ note });

      let leaky: request.Response;
      let down: request.Response;
      try {
        // 1. luồng thường + 2. sai dữ liệu (quá dài, chứa canary)
        await write(`${canary} ghi chú thường`);
        await write(
          `${canary}${'x'.repeat(ORDER_INTERNAL_NOTE_MAX_LENGTH + 1)}`,
        );
        // 3. lỗi kiểm tra tham số của Prisma mang NGUYÊN giá trị đã ghi (kể cả nội dung ghi chú)
        jest
          .spyOn(prismaService.order, 'updateMany')
          .mockRejectedValueOnce(
            new Prisma.PrismaClientValidationError(
              `Invalid invocation: data: { internalNote: "${canary}" }`,
              { clientVersion: 'test' },
            ),
          );
        leaky = await write(`${canary} lỗi Prisma`);
        // 4. lỗi hạ tầng bất kỳ
        jest
          .spyOn(prismaService.order, 'updateMany')
          .mockRejectedValueOnce(new Error('db down'));
        down = await write(`${canary} DB sập`);
      } finally {
        jest.restoreAllMocks();
        restores.forEach((restore) => restore());
      }

      expect(leaky.status).toBe(500);
      expect(down.status).toBe(500);
      expect(JSON.stringify([leaky.body, down.body])).not.toContain(canary);
      const logs = captured.join('\n');
      // Không phải test rỗng: các lỗi cố ý ở trên PHẢI đã để lại dấu vết trong log...
      expect(logs).toContain('db down');
      expect(logs).toContain('details omitted');
      // ...nhưng không có nội dung ghi chú.
      expect(logs).not.toContain(canary);
    });
  });

  describe('danh sách đơn của Seller không có ghi chú', () => {
    it('mục đơn ở danh sách không có trường internalNote, dù đơn có ghi chú', async () => {
      const { orderId } = await seedOrder({ shopId: shopA, status: 'PENDING' });
      await setNote(sellerA, shopA, orderId, { note: 'ghi chú' });

      const list = sellerOrderListResponseSchema.parse(
        data(await sellerA.get(`/api/v1/shops/${shopA}/orders?limit=50`)),
      );
      const raw = (await sellerA.get(`/api/v1/shops/${shopA}/orders?limit=50`))
        .body as {
        data: { items: Record<string, unknown>[] };
      };

      expect(list.items.some((item) => item.id === orderId)).toBe(true);
      expect(raw.data.items.every((item) => !('internalNote' in item))).toBe(
        true,
      );
    });
  });

  describe('tài liệu API', () => {
    it('Swagger khớp hành vi thật: PATCH khai báo đúng 200 và mọi status đã quan sát được đều được khai báo', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('order').setVersion('0').build(),
      );
      const operation = (
        document.paths[
          '/api/v1/shops/{shopId}/orders/{orderId}/internal-note'
        ] as Record<string, { responses: Record<string, unknown> }> | undefined
      )?.patch;

      expect(operation).toBeDefined();
      const documented = Object.keys(operation?.responses ?? {}).map(Number);
      expect(documented.filter((s) => s >= 200 && s < 300)).toEqual([200]);
      // 500 chỉ do test cố ý phá lúc ghi, không phải hành vi cần tài liệu.
      for (const status of [...observed].filter((s) => s !== 500)) {
        expect(documented).toContain(status);
      }
      expect([...observed].filter((s) => s !== 500).sort()).toEqual([
        200, 400, 401, 403, 404,
      ]);
    });
  });
});
