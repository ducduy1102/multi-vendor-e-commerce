import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  PrismaClient,
  type AccountStatus,
  type ShopStatus,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  adminUserDetailSchema,
  SHOP_CASCADE_SUSPEND_REASON,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import {
  cleanupByTag,
  createShopWithProduct,
  createVariant,
} from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';
import { seedAdmin } from '../../../prisma/seed-admin';
import { ShopStatusService } from '../shop/shop-status.service';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho việc khoá / mở lại SHOP theo tài khoản chủ shop (Week11.md
// 3.4, D2). Chứng minh điều unit test với mock không chứng minh được: shop APPROVED của chủ bị khoá thật sự SUSPENDED trong DB
// kèm ShopStatusHistory (actor SYSTEM, mã OWNER_ACCOUNT_SUSPENDED), sản phẩm biến khỏi API công khai và hội thoại thành
// chỉ-đọc NGAY, mở lại từ tạm khoá chỉ mở đúng shop do chính lần khoá đó khoá (kể cả sau nhiều vòng khoá → cấm → mở), mở lại
// từ bị cấm không tự mở shop nào, không duyệt được shop của chủ đang bị khoá, cascade lỗi giữa chừng thì CẢ tài khoản lẫn mọi
// shop cùng rollback, và một lần duyệt chạy song song với một lần khoá chủ shop không để lại shop APPROVED của chủ bị khoá.
// Chạy: `pnpm test:int`.
const TAG = 'it-ushop-';
const PASSWORD = 'password123';
const REASON = 'Vi phạm điều khoản sử dụng';

describe('Cascade shop theo tài khoản chủ shop (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const fakeMail = createFakeMail();
  const stamp = Date.now();
  const P = `${TAG}${stamp}-`;
  let seq = 0;

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  let admin: Agent;
  let adminId: string;

  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;

  // --- Dựng dữ liệu ------------------------------------------------------------------------------

  async function seedOwner(
    input: { status?: AccountStatus; locale?: 'vi' | 'en' } = {},
  ) {
    const email = `${P}${seq++}@test.local`;
    const row = await prisma.user.create({
      data: {
        email,
        // Tên trung tính (ASCII, không chứa chữ "shop"): tên người nhận nằm trong lời chào của email nên nếu có chữ Việt hay
        // chữ "shop" thì các test "email không nhắc tới shop / không lẫn tiếng Việt" sẽ đỏ vì chính lời chào.
        name: 'An',
        accountStatus: input.status ?? 'ACTIVE',
        locale: input.locale ?? 'vi',
        emailVerifiedAt: new Date(),
        refreshTokenHash: 'CANARY-REFRESH-HASH',
      },
      select: { id: true },
    });
    return { id: row.id, email };
  }

  // Shop do `ownerId` sở hữu, có 1 sản phẩm PUBLISHED + 1 variant còn hàng, ở trạng thái `status`.
  async function createShop(ownerId: string, status: ShopStatus) {
    const base = await createShopWithProduct(prisma, TAG);
    await prisma.shop.update({
      where: { id: base.shopId },
      data: { ownerId, status },
    });
    const variant = await createVariant(prisma, base, { stock: 10 });
    return { ...base, variantId: variant.id };
  }

  const suspendUser = (
    id: string,
    status: 'SUSPENDED' | 'BANNED' = 'SUSPENDED',
    reason = REASON,
  ) => admin.post(`/api/v1/admin/users/${id}/suspend`).send({ status, reason });
  const reactivateUser = (id: string, reason = REASON) =>
    admin.post(`/api/v1/admin/users/${id}/reactivate`).send({ reason });
  const patchShop = (
    shopId: string,
    payload: { status: string; reason?: string },
  ) => admin.patch(`/api/v1/admin/shops/${shopId}/status`).send(payload);

  const shopRow = (id: string) =>
    prisma.shop.findUniqueOrThrow({
      where: { id },
      select: { status: true, statusReason: true, statusChangedAt: true },
    });
  const historyOf = (shopId: string) =>
    prisma.shopStatusHistory.findMany({
      where: { shopId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  const userRow = (id: string) =>
    prisma.user.findUniqueOrThrow({
      where: { id },
      select: { accountStatus: true, refreshTokenHash: true },
    });
  const auditRows = (id: string) =>
    prisma.adminAuditLog.findMany({
      where: { targetType: 'USER', targetId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  const publicProductIds = async (shopId: string) => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/products?shopId=${shopId}`)
      .expect(200);
    return (
      (res.body as { data: { items: { id: string }[] } }).data.items ?? []
    ).map((item) => item.id);
  };

  // Email tài khoản gửi cho `to` (loại bỏ email trạng thái shop do các PATCH sinh ra).
  const accountMailsTo = (to: string) =>
    fakeMail.sent.filter(
      (mail) => mail.to === to && /tài khoản|account/i.test(mail.subject),
    );

  // Chờ cho tới khi có ít nhất `count` câu UPDATE trên bảng `table` đang bị chặn bởi khoá hàng — điều kiện thật, không ngủ cố định.
  async function untilBlocked(table: 'users' | 'shops', count = 1) {
    await untilBlockedQuery(`UPDATE "public"."${table}"%`, count);
  }
  // Như trên nhưng theo mẫu LIKE của chính câu lệnh đang chờ (vd lần quét shop FOR UPDATE).
  async function untilBlockedQuery(pattern: string, count = 1) {
    for (let attempt = 0; attempt < 250; attempt++) {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query LIKE ${pattern}`;
      if (Number(rows[0].n) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`câu lệnh ${pattern} không bị chặn như dự kiến`);
  }
  // supertest chỉ gửi request khi được `then` — ép gửi NGAY để các request chồng lên nhau.
  const fire = <T>(pending: PromiseLike<T>) => Promise.resolve(pending);

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
    await app.listen(0);

    const adminEmail = `${P}admin@test.local`;
    await seedAdmin(prisma, { email: adminEmail, password: PASSWORD });
    admin = newAgent();
    await admin
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: PASSWORD })
      .expect(200);
    adminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: adminEmail },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(() => {
    fakeMail.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  // --- Khoá / cấm kéo theo shop ------------------------------------------------------------------

  describe.each(['SUSPENDED', 'BANNED'] as const)(
    'khoá tài khoản (%s) kéo theo shop',
    (status) => {
      it('chỉ shop APPROVED của đúng chủ bị khoá; PENDING / REJECTED / shop Admin tự khoá / shop của người khác giữ nguyên', async () => {
        const owner = await seedOwner();
        const other = await seedOwner();
        const approved = await createShop(owner.id, 'APPROVED');
        const pending = await createShop(owner.id, 'PENDING');
        const rejected = await createShop(owner.id, 'REJECTED');
        const manual = await createShop(owner.id, 'APPROVED');
        await patchShop(manual.shopId, {
          status: 'SUSPENDED',
          reason: 'Admin khoá tay',
        }).expect(200);
        const bystander = await createShop(other.id, 'APPROVED');
        const manualHistoryBefore = await historyOf(manual.shopId);

        const res = await suspendUser(owner.id, status);

        expect(res.status).toBe(200);
        // Shop APPROVED của chủ ⇒ SUSPENDED với MÃ cascade làm lý do.
        expect(await shopRow(approved.shopId)).toMatchObject({
          status: 'SUSPENDED',
          statusReason: SHOP_CASCADE_SUSPEND_REASON,
        });
        // Các shop còn lại không đổi.
        expect(await shopRow(pending.shopId)).toMatchObject({
          status: 'PENDING',
        });
        expect(await shopRow(rejected.shopId)).toMatchObject({
          status: 'REJECTED',
        });
        expect(await shopRow(manual.shopId)).toMatchObject({
          status: 'SUSPENDED',
          statusReason: 'Admin khoá tay',
        });
        expect(await historyOf(manual.shopId)).toEqual(manualHistoryBefore);
        expect(await shopRow(bystander.shopId)).toMatchObject({
          status: 'APPROVED',
        });
      });

      it('ShopStatusHistory: một dòng APPROVED → SUSPENDED, actor SYSTEM (không có actorId), ghi chú là mã cascade, trùng giờ với statusChangedAt', async () => {
        const owner = await seedOwner();
        const shop = await createShop(owner.id, 'APPROVED');

        await suspendUser(owner.id, status).expect(200);

        const rows = await historyOf(shop.shopId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          fromStatus: 'APPROVED',
          toStatus: 'SUSPENDED',
          actorType: 'SYSTEM',
          actorId: null,
          note: SHOP_CASCADE_SUSPEND_REASON,
        });
        expect((await shopRow(shop.shopId)).statusChangedAt).toEqual(
          rows[0].createdAt,
        );
      });

      it('nhiều shop APPROVED (mô hình cho phép) ⇒ khoá hết; nhật ký quản trị ghi số shop; email nhắc tới shop', async () => {
        const owner = await seedOwner();
        const a = await createShop(owner.id, 'APPROVED');
        const b = await createShop(owner.id, 'APPROVED');

        await suspendUser(owner.id, status).expect(200);

        expect((await shopRow(a.shopId)).status).toBe('SUSPENDED');
        expect((await shopRow(b.shopId)).status).toBe('SUSPENDED');
        expect((await auditRows(owner.id))[0].meta).toEqual({
          from: 'ACTIVE',
          to: status,
          shopsSuspended: 2,
        });
        const [mail] = accountMailsTo(owner.email);
        expect(mail.html).toContain('Shop của bạn cũng bị tạm ngừng');
      });

      it('chủ không có shop nào ⇒ meta 0 và email KHÔNG nhắc tới shop', async () => {
        const owner = await seedOwner();

        await suspendUser(owner.id, status).expect(200);

        expect((await auditRows(owner.id))[0].meta).toMatchObject({
          shopsSuspended: 0,
        });
        expect(accountMailsTo(owner.email)[0].html).not.toMatch(/shop/i);
      });

      it('sản phẩm biến khỏi API công khai NGAY, dữ liệu giữ nguyên (không xoá / ẩn gì)', async () => {
        const owner = await seedOwner();
        const shop = await createShop(owner.id, 'APPROVED');
        expect(await publicProductIds(shop.shopId)).toEqual([shop.productId]);
        await request(app.getHttpServer())
          .get(`/api/v1/products/${shop.productId}`)
          .expect(200);

        await suspendUser(owner.id, status).expect(200);

        expect(await publicProductIds(shop.shopId)).toEqual([]);
        await request(app.getHttpServer())
          .get(`/api/v1/products/${shop.productId}`)
          .expect(404);
        const product = await prisma.product.findUniqueOrThrow({
          where: { id: shop.productId },
          select: { status: true },
        });
        expect(product.status).toBe('PUBLISHED');
      });
    },
  );

  it('SUSPENDED → BANNED (nâng mức): shop vừa được mở lại giữa chừng cũng bị khoá theo; shop đã khoá giữ nguyên', async () => {
    const owner = await seedOwner();
    const cascaded = await createShop(owner.id, 'APPROVED');
    await suspendUser(owner.id, 'SUSPENDED').expect(200);
    // Mô phỏng một shop trở lại APPROVED trong lúc tài khoản đang bị tạm khoá (Admin không làm được qua API — bị chặn).
    const revived = await createShop(owner.id, 'APPROVED');

    await suspendUser(owner.id, 'BANNED').expect(200);

    expect((await shopRow(revived.shopId)).status).toBe('SUSPENDED');
    expect((await shopRow(cascaded.shopId)).status).toBe('SUSPENDED');
    expect((await auditRows(owner.id))[1].meta).toEqual({
      from: 'SUSPENDED',
      to: 'BANNED',
      shopsSuspended: 1,
    });
  });

  it('chi tiết người dùng (3.2) thấy shop ở trạng thái SUSPENDED sau khi bị kéo theo', async () => {
    const owner = await seedOwner();
    const shop = await createShop(owner.id, 'APPROVED');
    await suspendUser(owner.id).expect(200);

    const res = await admin.get(`/api/v1/admin/users/${owner.id}`).expect(200);

    const detail = adminUserDetailSchema.parse(
      (res.body as { data: unknown }).data,
    );
    expect(detail.shops).toEqual([
      expect.objectContaining({ id: shop.shopId, status: 'SUSPENDED' }),
    ]);
  });

  // --- Hội thoại chỉ-đọc -------------------------------------------------------------------------

  describe('hội thoại thành chỉ-đọc nhờ luật "shop không còn APPROVED" có sẵn', () => {
    it('người mua gửi tin: 201 trước khi khoá, 409 CHAT_SHOP_UNAVAILABLE sau khi khoá, gửi lại được sau khi mở lại', async () => {
      const owner = await seedOwner();
      const shop = await createShop(owner.id, 'APPROVED');
      const buyerEmail = `${P}buyer@test.local`;
      const buyer = newAgent();
      await buyer
        .post('/api/v1/auth/register')
        .send({ email: buyerEmail, password: PASSWORD, name: `${TAG}buyer` })
        .expect(201);
      await buyer
        .post('/api/v1/auth/login')
        .send({ email: buyerEmail, password: PASSWORD })
        .expect(200);
      const buyerRow = await prisma.user.update({
        where: { email: buyerEmail },
        data: { emailVerifiedAt: new Date() },
        select: { id: true },
      });
      const conversation = await prisma.conversation.create({
        data: { buyerId: buyerRow.id, shopId: shop.shopId },
        select: { id: true },
      });
      const send = () =>
        buyer
          .post(`/api/v1/conversations/${conversation.id}/messages`)
          .send({ content: 'Xin chào', clientMessageId: randomUUID() });

      expect((await send()).status).toBe(201);

      await suspendUser(owner.id).expect(200);
      const blocked = await send();
      expect([blocked.status, code(blocked)]).toEqual([
        409,
        'CHAT_SHOP_UNAVAILABLE',
      ]);

      await reactivateUser(owner.id).expect(200);
      expect((await send()).status).toBe(201);
    });
  });

  // --- Mở lại ------------------------------------------------------------------------------------

  describe('mở lại từ TẠM KHOÁ (SUSPENDED → ACTIVE)', () => {
    it('mở lại đúng shop do lần khoá này khoá; shop Admin tự khoá, PENDING, REJECTED giữ nguyên; sản phẩm hiện lại', async () => {
      const owner = await seedOwner();
      const cascaded = await createShop(owner.id, 'APPROVED');
      const manual = await createShop(owner.id, 'APPROVED');
      await patchShop(manual.shopId, {
        status: 'SUSPENDED',
        reason: 'Admin khoá tay',
      }).expect(200);
      const pending = await createShop(owner.id, 'PENDING');
      const rejected = await createShop(owner.id, 'REJECTED');
      await suspendUser(owner.id).expect(200);
      expect(await publicProductIds(cascaded.shopId)).toEqual([]);
      fakeMail.reset();

      const res = await reactivateUser(owner.id);

      expect(res.status).toBe(200);
      expect(await shopRow(cascaded.shopId)).toMatchObject({
        status: 'APPROVED',
        statusReason: null,
      });
      expect(await shopRow(manual.shopId)).toMatchObject({
        status: 'SUSPENDED',
        statusReason: 'Admin khoá tay',
      });
      expect((await shopRow(pending.shopId)).status).toBe('PENDING');
      expect((await shopRow(rejected.shopId)).status).toBe('REJECTED');
      expect(await publicProductIds(cascaded.shopId)).toEqual([
        cascaded.productId,
      ]);
    });

    it('ShopStatusHistory: thêm dòng SUSPENDED → APPROVED, actor SYSTEM, không ghi chú (không lý do)', async () => {
      const owner = await seedOwner();
      const shop = await createShop(owner.id, 'APPROVED');
      await suspendUser(owner.id).expect(200);

      await reactivateUser(owner.id).expect(200);

      const rows = await historyOf(shop.shopId);
      expect(
        rows.map((r) => `${r.fromStatus}>${r.toStatus}:${r.actorType}`),
      ).toEqual(['APPROVED>SUSPENDED:SYSTEM', 'SUSPENDED>APPROVED:SYSTEM']);
      expect(rows[1]).toMatchObject({ actorId: null, note: null });
      expect((await shopRow(shop.shopId)).statusChangedAt).toEqual(
        rows[1].createdAt,
      );
    });

    it('nhật ký quản trị ghi số shop được mở lại; email báo shop được mở lại', async () => {
      const owner = await seedOwner();
      await createShop(owner.id, 'APPROVED');
      await suspendUser(owner.id).expect(200);
      fakeMail.reset();

      await reactivateUser(owner.id).expect(200);

      expect((await auditRows(owner.id))[1].meta).toEqual({
        from: 'SUSPENDED',
        to: 'ACTIVE',
        shopsReopened: 1,
      });
      expect(accountMailsTo(owner.email)[0].html).toContain(
        'Shop của bạn cũng đã được mở lại',
      );
    });

    it('dòng lịch sử mới nhất của shop không còn là dòng cascade (có người đổi sau đó) ⇒ KHÔNG mở lại', async () => {
      const owner = await seedOwner();
      const shop = await createShop(owner.id, 'APPROVED');
      await suspendUser(owner.id).expect(200);
      // Một thao tác khác ghi vào lịch sử SAU dòng cascade (vd Admin đã xem xét thủ công và ghi nhận khoá riêng).
      await prisma.shopStatusHistory.create({
        data: {
          shopId: shop.shopId,
          fromStatus: 'SUSPENDED',
          toStatus: 'SUSPENDED',
          actorType: 'ADMIN',
          actorId: adminId,
          note: 'Khoá riêng sau khi xem xét',
          createdAt: new Date(Date.now() + 1000),
        },
      });

      await reactivateUser(owner.id).expect(200);

      expect((await shopRow(shop.shopId)).status).toBe('SUSPENDED');
      expect((await auditRows(owner.id))[1].meta).toMatchObject({
        shopsReopened: 0,
      });
    });

    // Hai ca dưới chỉ sai MỘT trường mỗi ca. Ca trên (ADMIN + ghi chú khác) sai cả hai nên điều kiện nào còn lại cũng chặn được,
    // không chứng minh được từng điều kiện có tác dụng riêng.
    it.each([
      [
        'actor là ADMIN dù ghi chú trùng mã cascade',
        { actorType: 'ADMIN' as const, note: SHOP_CASCADE_SUSPEND_REASON },
      ],
      [
        'actor SYSTEM nhưng ghi chú KHÁC mã cascade (vd một đợt dọn dữ liệu)',
        { actorType: 'SYSTEM' as const, note: 'DATA_CLEANUP' },
      ],
    ])('dòng lịch sử mới nhất có %s ⇒ KHÔNG mở lại', async (_name, latest) => {
      const owner = await seedOwner();
      const shop = await createShop(owner.id, 'APPROVED');
      await suspendUser(owner.id).expect(200);
      await prisma.shopStatusHistory.create({
        data: {
          shopId: shop.shopId,
          fromStatus: 'SUSPENDED',
          toStatus: 'SUSPENDED',
          actorType: latest.actorType,
          actorId: latest.actorType === 'ADMIN' ? adminId : null,
          note: latest.note,
          createdAt: new Date(Date.now() + 1000),
        },
      });

      await reactivateUser(owner.id).expect(200);

      expect((await shopRow(shop.shopId)).status).toBe('SUSPENDED');
    });

    it('shop Admin đã khoá tay TRƯỚC khi khoá tài khoản không bao giờ bị mở lại', async () => {
      const owner = await seedOwner();
      const manual = await createShop(owner.id, 'APPROVED');
      await patchShop(manual.shopId, {
        status: 'SUSPENDED',
        reason: 'Admin khoá tay',
      }).expect(200);
      await suspendUser(owner.id).expect(200);

      await reactivateUser(owner.id).expect(200);

      expect(await shopRow(manual.shopId)).toMatchObject({
        status: 'SUSPENDED',
        statusReason: 'Admin khoá tay',
      });
    });
  });

  describe('mở lại từ BỊ CẤM (BANNED → ACTIVE)', () => {
    it('KHÔNG tự mở shop nào; email báo trước shop vẫn bị khoá; Admin mở shop riêng được', async () => {
      const owner = await seedOwner();
      const shop = await createShop(owner.id, 'APPROVED');
      await suspendUser(owner.id, 'BANNED').expect(200);
      fakeMail.reset();

      await reactivateUser(owner.id).expect(200);

      expect(await shopRow(shop.shopId)).toMatchObject({
        status: 'SUSPENDED',
        statusReason: SHOP_CASCADE_SUSPEND_REASON,
      });
      expect(await publicProductIds(shop.shopId)).toEqual([]);
      expect((await auditRows(owner.id))[1].meta).toEqual({
        from: 'BANNED',
        to: 'ACTIVE',
        shopsStillSuspended: 1,
      });
      expect(accountMailsTo(owner.email)[0].html).toContain(
        'Shop của bạn vẫn đang bị tạm ngừng',
      );

      // Chủ đã ACTIVE ⇒ Admin mở shop riêng được.
      await patchShop(shop.shopId, { status: 'APPROVED' }).expect(200);
      expect((await shopRow(shop.shopId)).status).toBe('APPROVED');
    });

    it('chủ không có shop bị khoá ⇒ email không nhắc tới shop', async () => {
      const owner = await seedOwner();
      await suspendUser(owner.id, 'BANNED').expect(200);
      fakeMail.reset();

      await reactivateUser(owner.id).expect(200);

      expect(accountMailsTo(owner.email)[0].html).not.toMatch(/shop/i);
    });
  });

  it('chỉ mở lại shop của lần khoá HIỆN TẠI: tạm khoá → cấm → mở → tạm khoá lại → mở ⇒ shop vẫn bị khoá (luật "cấm thì phải xét lại")', async () => {
    const owner = await seedOwner();
    const shop = await createShop(owner.id, 'APPROVED');

    await suspendUser(owner.id, 'SUSPENDED').expect(200); // shop bị cascade (lần khoá 1)
    await suspendUser(owner.id, 'BANNED').expect(200); // nâng lên cấm
    await reactivateUser(owner.id).expect(200); // mở từ CẤM ⇒ shop KHÔNG tự mở
    expect((await shopRow(shop.shopId)).status).toBe('SUSPENDED');

    await suspendUser(owner.id, 'SUSPENDED').expect(200); // lần khoá 2: shop đã SUSPENDED nên không có dòng cascade mới
    expect((await auditRows(owner.id))[3].meta).toMatchObject({
      shopsSuspended: 0,
    });
    await reactivateUser(owner.id).expect(200); // mở từ TẠM KHOÁ lần 2

    // Dòng cascade của shop thuộc lần khoá 1 (trước lần khoá hiện tại) ⇒ KHÔNG được mở nhờ dòng đó.
    expect((await shopRow(shop.shopId)).status).toBe('SUSPENDED');
    expect((await auditRows(owner.id))[4].meta).toMatchObject({
      shopsReopened: 0,
    });
    // Admin vẫn mở thủ công được.
    await patchShop(shop.shopId, { status: 'APPROVED' }).expect(200);
  });

  // --- Không duyệt được shop của chủ đang bị khoá -------------------------------------------------

  describe('duyệt / mở khoá shop khi chủ không còn ACTIVE', () => {
    it.each(['SUSPENDED', 'BANNED', 'DEACTIVATED'] as const)(
      'duyệt shop PENDING của chủ %s ⇒ 409 SHOP_OWNER_NOT_ACTIVE, shop/lịch sử/email không đổi',
      async (ownerStatus) => {
        const owner = await seedOwner({ status: ownerStatus });
        const shop = await createShop(owner.id, 'PENDING');
        const before = await historyOf(shop.shopId);

        const res = await patchShop(shop.shopId, { status: 'APPROVED' });

        expect([res.status, code(res)]).toEqual([409, 'SHOP_OWNER_NOT_ACTIVE']);
        expect((await shopRow(shop.shopId)).status).toBe('PENDING');
        expect(await historyOf(shop.shopId)).toEqual(before);
        expect(fakeMail.sent).toHaveLength(0);
      },
    );

    it('mở khoá shop đang bị cascade khi chủ vẫn bị khoá ⇒ 409; chủ ACTIVE trở lại thì mở được', async () => {
      const owner = await seedOwner();
      const shop = await createShop(owner.id, 'APPROVED');
      await suspendUser(owner.id, 'BANNED').expect(200);

      const blocked = await patchShop(shop.shopId, { status: 'APPROVED' });
      expect([blocked.status, code(blocked)]).toEqual([
        409,
        'SHOP_OWNER_NOT_ACTIVE',
      ]);
      expect((await shopRow(shop.shopId)).status).toBe('SUSPENDED');

      await reactivateUser(owner.id).expect(200);
      await patchShop(shop.shopId, { status: 'APPROVED' }).expect(200);
    });

    it('cạnh sai (APPROVED → APPROVED) với chủ bị khoá ⇒ vẫn là SHOP_INVALID_TRANSITION, không bị che bởi lỗi chủ shop', async () => {
      const owner = await seedOwner({ status: 'BANNED' });
      const shop = await createShop(owner.id, 'APPROVED');

      const res = await patchShop(shop.shopId, { status: 'APPROVED' });

      expect([res.status, code(res)]).toEqual([409, 'SHOP_INVALID_TRANSITION']);
    });

    it('TỪ CHỐI shop PENDING của chủ bị khoá vẫn được (chỉ việc cho nhận đơn lại mới bị chặn)', async () => {
      const owner = await seedOwner({ status: 'BANNED' });
      const shop = await createShop(owner.id, 'PENDING');

      await patchShop(shop.shopId, {
        status: 'REJECTED',
        reason: 'Thiếu giấy tờ',
      }).expect(200);

      expect((await shopRow(shop.shopId)).status).toBe('REJECTED');
    });

    it('chủ được mở lại ⇒ duyệt shop PENDING bình thường', async () => {
      const owner = await seedOwner();
      const shop = await createShop(owner.id, 'PENDING');
      await suspendUser(owner.id).expect(200);
      expect(
        (await patchShop(shop.shopId, { status: 'APPROVED' })).status,
      ).toBe(409);

      await reactivateUser(owner.id).expect(200);
      await patchShop(shop.shopId, { status: 'APPROVED' }).expect(200);

      expect((await shopRow(shop.shopId)).status).toBe('APPROVED');
    });
  });

  // --- Rollback ----------------------------------------------------------------------------------

  describe('cascade lỗi giữa chừng', () => {
    it('shop thứ hai lỗi ⇒ 500 và CẢ tài khoản lẫn shop thứ nhất rollback: không khoá nửa vời, không nhật ký, không email', async () => {
      const owner = await seedOwner();
      const a = await createShop(owner.id, 'APPROVED');
      const b = await createShop(owner.id, 'APPROVED');
      const service = app.get(ShopStatusService, { strict: false });
      const real = service.transition.bind(
        service,
      ) as ShopStatusService['transition'];
      let calls = 0;
      jest
        .spyOn(service, 'transition')
        .mockImplementation((...args: Parameters<typeof real>) =>
          ++calls === 2
            ? Promise.reject(new Error('cascade down'))
            : real(...args),
        );

      // Gọi thẳng (500 là điều ta cố ý gây ra).
      const res = await admin
        .post(`/api/v1/admin/users/${owner.id}/suspend`)
        .send({ status: 'SUSPENDED', reason: REASON });

      expect(res.status).toBe(500);
      expect(calls).toBe(2);
      expect(await userRow(owner.id)).toEqual({
        accountStatus: 'ACTIVE',
        refreshTokenHash: 'CANARY-REFRESH-HASH',
      });
      expect((await shopRow(a.shopId)).status).toBe('APPROVED');
      expect((await shopRow(b.shopId)).status).toBe('APPROVED');
      expect(await historyOf(a.shopId)).toHaveLength(0);
      expect(await historyOf(b.shopId)).toHaveLength(0);
      expect(await auditRows(owner.id)).toHaveLength(0);
      expect(fakeMail.sent).toHaveLength(0);
    });
  });

  // --- Đua nhau ----------------------------------------------------------------------------------

  describe('duyệt shop chạy song song với khoá chủ shop', () => {
    it('duyệt đang chờ ghi, khoá chủ đến sau ⇒ việc khoá CHỜ lần duyệt (khoá chia sẻ trên hàng user) rồi mới quét shop APPROVED ⇒ shop vừa duyệt cũng bị khoá theo, không còn shop APPROVED của chủ bị khoá', async () => {
      const owner = await seedOwner();
      const shop = await createShop(owner.id, 'PENDING');

      // Giữ khoá hàng SHOP trong một transaction của test để lần duyệt dừng đúng ở bước ghi trạng thái shop — SAU khi đã kiểm
      // chủ shop (và đang giữ FOR SHARE trên hàng user).
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => (locked = resolve));
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM shops WHERE id = ${shop.shopId} FOR UPDATE`;
          locked();
          await gate;
        },
        { timeout: 30_000 },
      );
      await lockTaken;

      const approving = fire(patchShop(shop.shopId, { status: 'APPROVED' }));
      await untilBlocked('shops');
      // Lần duyệt đã qua bước kiểm chủ shop (ACTIVE). Giờ khoá chủ: nó phải bị chặn ở UPDATE hàng user.
      const locking = fire(suspendUser(owner.id));
      await untilBlocked('users');

      release();
      await holder;
      const [approved, locked200] = await Promise.all([approving, locking]);

      expect(approved.status).toBe(200);
      expect(locked200.status).toBe(200);
      expect((await userRow(owner.id)).accountStatus).toBe('SUSPENDED');
      // Bất biến: chủ bị khoá thì không có shop APPROVED nào.
      expect(await shopRow(shop.shopId)).toMatchObject({
        status: 'SUSPENDED',
        statusReason: SHOP_CASCADE_SUSPEND_REASON,
      });
      expect(
        (await historyOf(shop.shopId)).map(
          (r) => `${r.fromStatus}>${r.toStatus}:${r.actorType}`,
        ),
      ).toEqual(['PENDING>APPROVED:ADMIN', 'APPROVED>SUSPENDED:SYSTEM']);
      expect((await auditRows(owner.id))[0].meta).toMatchObject({
        shopsSuspended: 1,
      });
    });
  });

  describe('Admin khoá tay một shop đúng lúc khoá chủ shop', () => {
    it('lần quét shop APPROVED CHỜ khoá hàng rồi bỏ shop đã đổi: việc khoá chủ KHÔNG hỏng (200), không ghi đè lý do Admin, không dòng lịch sử thừa', async () => {
      const owner = await seedOwner();
      const shop = await createShop(owner.id, 'APPROVED');

      // Giả lập Admin khác đang khoá tay shop này: giữ khoá hàng, đổi trạng thái, chưa commit.
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => (locked = resolve));
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM shops WHERE id = ${shop.shopId} FOR UPDATE`;
          locked();
          await gate;
          await tx.shop.update({
            where: { id: shop.shopId },
            data: { status: 'SUSPENDED', statusReason: 'Admin khoá tay' },
          });
        },
        { timeout: 30_000 },
      );
      await lockTaken;

      const locking = fire(suspendUser(owner.id));
      // Lần quét "shop APPROVED của chủ" đã bị chặn bởi khoá hàng của Admin kia.
      await untilBlockedQuery('SELECT id FROM shops WHERE owner_id%');
      release();
      await holder;
      const res = await locking;

      // Không có FOR UPDATE: lần quét thấy shop còn APPROVED (bản cũ), transition đụng 409 SHOP_INVALID_TRANSITION và kéo theo
      // cả việc khoá tài khoản thất bại.
      expect(res.status).toBe(200);
      expect((await userRow(owner.id)).accountStatus).toBe('SUSPENDED');
      expect(await shopRow(shop.shopId)).toMatchObject({
        status: 'SUSPENDED',
        statusReason: 'Admin khoá tay',
      });
      expect(await historyOf(shop.shopId)).toHaveLength(0);
      expect((await auditRows(owner.id))[0].meta).toMatchObject({
        shopsSuspended: 0,
      });
    });
  });

  // --- Email theo ngôn ngữ -----------------------------------------------------------------------

  describe('câu nói thêm về shop trong email theo ngôn ngữ của chủ tài khoản', () => {
    it('en: ba câu tiếng Anh, không lẫn chữ Việt', async () => {
      const owner = await seedOwner({ locale: 'en' });
      await createShop(owner.id, 'APPROVED');

      // Lý do tiếng ANH: lý do là văn bản Admin nhập và được đưa nguyên vào email, nên lý do tiếng Việt sẽ làm email tiếng Anh
      // có chữ Việt dù template đúng.
      await suspendUser(owner.id, 'BANNED', 'Fraudulent activity').expect(200);
      const [suspendedMail] = accountMailsTo(owner.email);
      fakeMail.reset();
      await reactivateUser(owner.id, 'Appeal accepted').expect(200);
      const [reactivatedMail] = accountMailsTo(owner.email);

      expect(suspendedMail.html).toContain('Your shop has also been suspended');
      expect(reactivatedMail.html).toContain(
        'Your shop remains suspended and will be reviewed separately',
      );
      for (const mail of [suspendedMail, reactivatedMail]) {
        expect(mail.subject + mail.html).not.toMatch(
          /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i,
        );
      }
    });
  });
});
