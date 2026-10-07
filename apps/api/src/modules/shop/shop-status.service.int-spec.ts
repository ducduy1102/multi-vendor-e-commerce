import { PrismaClient, type ShopStatus } from '@prisma/client';
import { SHOP_STATUS_TRANSITIONS } from '@ecommerce/types';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { cleanupByTag, createUser } from '../../shared/testing/db-fixtures';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { ShopStatusService, type ShopActor } from './shop-status.service';
import { ShopService } from './shop.service';

// Integration test trên DB dev THẬT (cần Postgres đang chạy): chứng minh ShopStatusService và mốc đầu của
// createShop (Week8.md 3C.4) đúng ở mức mà unit test với mock không chứng minh được — UPDATE có điều
// kiện chạy đúng trên Postgres thật, 2 transaction đồng thời chỉ 1 bên thắng, rollback kéo theo cả
// history, createShop + mốc đầu cùng 1 transaction. Chạy: `pnpm test:int`.
const TAG = 'it-shop-status-';

describe('ShopStatusService (DB thật)', () => {
  const prisma = new PrismaClient();
  const service = new ShopStatusService();
  const shopService = new ShopService(
    prisma as unknown as PrismaService,
    service,
  );

  let counter = 0;

  beforeAll(() => cleanupByTag(prisma, TAG));

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  async function createShop(
    status: ShopStatus,
    statusReason: string | null = null,
  ) {
    const owner = await createUser(prisma, TAG);
    const shop = await prisma.shop.create({
      data: {
        ownerId: owner.id,
        name: `${TAG}shop`,
        slug: `${TAG}shop-${Date.now().toString(36)}-${counter++}`,
        status,
        statusReason,
        // Mốc đổi trạng thái cũ đặt sẵn trong QUÁ KHỨ: `@default(now())` do engine Prisma sinh còn statusChangedAt
        // của lần chuyển là `new Date()` của Node — trên Windows 2 đồng hồ này có thể lệch vài ms nên so sánh
        // "mốc mới > mốc mặc định" sẽ chập chờn. Cho fixture cách xa 1 giờ thì so sánh luôn đúng.
        statusChangedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
      select: { id: true, ownerId: true },
    });
    return { shopId: shop.id, ownerId: owner.id };
  }

  const historyOf = (shopId: string) =>
    prisma.shopStatusHistory.findMany({
      where: { shopId },
      orderBy: { createdAt: 'asc' },
    });

  const shopOf = (shopId: string) =>
    prisma.shop.findUniqueOrThrow({ where: { id: shopId } });

  const ADMIN: ShopActor = { type: 'ADMIN', id: 'admin-int-1' };
  const OWNER = (id: string): ShopActor => ({ type: 'OWNER', id });

  describe('transition — từng cạnh của bảng trên Postgres thật', () => {
    it.each(
      SHOP_STATUS_TRANSITIONS.map(
        (edge) => [edge.from, edge.to, edge.actor] as const,
      ),
    )(
      '%s → %s (%s): đổi status/statusReason/statusChangedAt/updatedAt và ghi đúng 1 dòng history',
      async (from, to, actorType) => {
        const carriesReason = to === 'REJECTED' || to === 'SUSPENDED';
        const { shopId, ownerId } = await createShop(
          from,
          from === 'REJECTED' || from === 'SUSPENDED' ? 'lý do cũ' : null,
        );
        const before = await shopOf(shopId);
        const actor: ShopActor = actorType === 'OWNER' ? OWNER(ownerId) : ADMIN;

        await prisma.$transaction((tx) =>
          service.transition(tx, shopId, from, to, actor, 'lý do mới'),
        );

        const after = await shopOf(shopId);
        expect(after.status).toBe(to);
        expect(after.statusReason).toBe(carriesReason ? 'lý do mới' : null);
        expect(after.statusChangedAt.getTime()).toBeGreaterThan(
          before.statusChangedAt.getTime(),
        );
        expect(after.updatedAt.getTime()).toBeGreaterThan(
          before.updatedAt.getTime(),
        );

        const history = await historyOf(shopId);
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({
          fromStatus: from,
          toStatus: to,
          actorType,
          actorId: actor.type === 'SYSTEM' ? null : actor.id,
          note: carriesReason ? 'lý do mới' : null,
        });
        // Cột phi chuẩn luôn bằng đúng mốc history mới nhất.
        expect(history[0].createdAt.getTime()).toBe(
          after.statusChangedAt.getTime(),
        );
      },
    );
  });

  it('shop không còn ở trạng thái "từ" ⇒ 409, không đổi gì, không ghi history', async () => {
    const { shopId } = await createShop('APPROVED');

    await expectAppException(
      prisma.$transaction((tx) =>
        service.transition(tx, shopId, 'PENDING', 'REJECTED', ADMIN, 'x'),
      ),
      { status: 409, code: 'SHOP_INVALID_TRANSITION' },
    );

    expect((await shopOf(shopId)).status).toBe('APPROVED');
    expect(await historyOf(shopId)).toHaveLength(0);
  });

  it('actor sai (Admin làm cạnh của Owner) ⇒ 409, shop REJECTED nguyên vẹn', async () => {
    const { shopId } = await createShop('REJECTED', 'Thiếu giấy phép');

    await expectAppException(
      prisma.$transaction((tx) =>
        service.transition(tx, shopId, 'REJECTED', 'PENDING', ADMIN),
      ),
      { status: 409, code: 'SHOP_INVALID_TRANSITION' },
    );

    const shop = await shopOf(shopId);
    expect(shop.status).toBe('REJECTED');
    expect(shop.statusReason).toBe('Thiếu giấy phép');
    expect(await historyOf(shopId)).toHaveLength(0);
  });

  it('transaction rollback — status, statusReason, statusChangedAt và history cùng quay về', async () => {
    const { shopId } = await createShop('PENDING');
    const before = await shopOf(shopId);

    await expect(
      prisma.$transaction(async (tx) => {
        await service.transition(
          tx,
          shopId,
          'PENDING',
          'REJECTED',
          ADMIN,
          'Thiếu giấy phép',
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const after = await shopOf(shopId);
    expect(after.status).toBe('PENDING');
    expect(after.statusReason).toBeNull();
    expect(after.statusChangedAt.getTime()).toBe(
      before.statusChangedAt.getTime(),
    );
    expect(await historyOf(shopId)).toHaveLength(0);
  });

  it('race: 2 Admin duyệt và từ chối CÙNG 1 shop PENDING — đúng 1 bên thắng, đúng 1 dòng history khớp trạng thái cuối', async () => {
    const { shopId } = await createShop('PENDING');

    const results = await Promise.allSettled([
      prisma.$transaction((tx) =>
        service.transition(tx, shopId, 'PENDING', 'APPROVED', {
          type: 'ADMIN',
          id: 'admin-a',
        }),
      ),
      prisma.$transaction((tx) =>
        service.transition(
          tx,
          shopId,
          'PENDING',
          'REJECTED',
          { type: 'ADMIN', id: 'admin-b' },
          'Thiếu giấy phép',
        ),
      ),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected');
    expect(lost).toMatchObject({
      reason: { code: 'SHOP_INVALID_TRANSITION' },
    });

    const history = await historyOf(shopId);
    expect(history).toHaveLength(1);
    const shop = await shopOf(shopId);
    expect(shop.status).toBe(history[0].toStatus);
    expect(shop.statusReason).toBe(history[0].note);
  });

  it('race: chủ shop bấm "gửi duyệt lại" 2 lần đồng thời (2 tab / bấm đúp) — đúng 1 lần thắng, đúng 1 dòng history', async () => {
    const { shopId, ownerId } = await createShop('REJECTED', 'Thiếu giấy phép');

    const results = await Promise.allSettled([
      prisma.$transaction((tx) =>
        service.transition(tx, shopId, 'REJECTED', 'PENDING', OWNER(ownerId)),
      ),
      prisma.$transaction((tx) =>
        service.transition(tx, shopId, 'REJECTED', 'PENDING', OWNER(ownerId)),
      ),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'SHOP_INVALID_TRANSITION' },
    });
    const history = await historyOf(shopId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromStatus: 'REJECTED',
      toStatus: 'PENDING',
      actorType: 'OWNER',
      actorId: ownerId,
    });
    const shop = await shopOf(shopId);
    expect(shop.status).toBe('PENDING');
    expect(shop.statusReason).toBeNull(); // nộp lại xoá lý do hiện tại
  });

  it('vòng đời đầy đủ: từ chối → nộp lại → duyệt → khoá → mở khoá, history đủ và đúng thứ tự', async () => {
    const { shopId, ownerId } = await createShop('PENDING');
    const step = (
      from: ShopStatus,
      to: ShopStatus,
      actor: ShopActor,
      reason?: string,
    ) =>
      prisma.$transaction((tx) =>
        service.transition(tx, shopId, from, to, actor, reason),
      );

    await step('PENDING', 'REJECTED', ADMIN, 'Thiếu giấy phép');
    await step('REJECTED', 'PENDING', OWNER(ownerId));
    await step('PENDING', 'APPROVED', ADMIN);
    await step('APPROVED', 'SUSPENDED', ADMIN, 'Bán hàng cấm');
    await step('SUSPENDED', 'APPROVED', ADMIN);

    const history = await historyOf(shopId);
    expect(history.map((h) => `${h.fromStatus}>${h.toStatus}`)).toEqual([
      'PENDING>REJECTED',
      'REJECTED>PENDING',
      'PENDING>APPROVED',
      'APPROVED>SUSPENDED',
      'SUSPENDED>APPROVED',
    ]);
    expect(history.map((h) => h.note)).toEqual([
      'Thiếu giấy phép',
      null,
      null,
      'Bán hàng cấm',
      null,
    ]);
    const shop = await shopOf(shopId);
    expect(shop.status).toBe('APPROVED');
    expect(shop.statusReason).toBeNull();
    // statusChangedAt = mốc history mới nhất.
    expect(shop.statusChangedAt.getTime()).toBe(
      history[history.length - 1].createdAt.getTime(),
    );
  });

  describe('createShop — mốc đầu null → PENDING cùng transaction', () => {
    it('tạo shop ghi đúng 1 dòng history: null → PENDING, actor OWNER = chính người tạo, createdAt = shop.createdAt = statusChangedAt', async () => {
      const owner = await createUser(prisma, TAG);

      const shop = await shopService.createShop(owner.id, {
        name: `${TAG}Shop Đầu Tiên`,
      });

      const history = await historyOf(shop.id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        fromStatus: null,
        toStatus: 'PENDING',
        actorType: 'OWNER',
        actorId: owner.id,
        note: null,
      });
      expect(history[0].createdAt.getTime()).toBe(shop.createdAt.getTime());
      expect(shop.statusChangedAt.getTime()).toBe(shop.createdAt.getTime());
      expect(shop.status).toBe('PENDING');
    });

    it('2 shop trùng tên: shop thứ 2 nhận slug -2 và mỗi shop có đúng 1 dòng mốc đầu (mỗi lần thử slug là 1 transaction riêng)', async () => {
      const ownerA = await createUser(prisma, TAG);
      const ownerB = await createUser(prisma, TAG);

      const first = await shopService.createShop(ownerA.id, {
        name: `${TAG}Cùng Tên`,
      });
      const second = await shopService.createShop(ownerB.id, {
        name: `${TAG}Cùng Tên`,
      });

      expect(second.slug).toBe(`${first.slug}-2`);
      expect(await historyOf(first.id)).toHaveLength(1);
      expect(await historyOf(second.id)).toHaveLength(1);
    });

    it('user đã có shop ⇒ 409 và không tạo thêm shop/history nào', async () => {
      const owner = await createUser(prisma, TAG);
      await shopService.createShop(owner.id, { name: `${TAG}Shop Một` });

      await expect(
        shopService.createShop(owner.id, { name: `${TAG}Shop Hai` }),
      ).rejects.toMatchObject({ status: 409 });

      expect(await prisma.shop.count({ where: { ownerId: owner.id } })).toBe(1);
      expect(
        await prisma.shopStatusHistory.count({
          where: { shop: { ownerId: owner.id } },
        }),
      ).toBe(1);
    });

    it('ghi mốc đầu lỗi ⇒ shop cũng KHÔNG được tạo (cùng transaction, không có shop mồ côi thiếu history)', async () => {
      const owner = await createUser(prisma, TAG);
      const failing = new ShopStatusService();
      jest
        .spyOn(failing, 'recordCreated')
        .mockRejectedValue(new Error('history down'));
      const brokenShopService = new ShopService(
        prisma as unknown as PrismaService,
        failing,
      );

      await expect(
        brokenShopService.createShop(owner.id, { name: `${TAG}Shop Lỗi` }),
      ).rejects.toThrow('history down');

      expect(await prisma.shop.count({ where: { ownerId: owner.id } })).toBe(0);
    });
  });
});
