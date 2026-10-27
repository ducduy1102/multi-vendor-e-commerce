import type { Prisma } from '@prisma/client';
import { SHOP_CASCADE_SUSPEND_REASON } from '@ecommerce/types';
import type { TxClient } from '../../shared/prisma/tx-client';
import type { ShopStatusService } from '../shop/shop-status.service';
import { AdminUserShopCascadeService } from './admin-user-shop-cascade.service';

// Logic không cần DB của việc khoá / mở lại shop theo tài khoản chủ shop (Week11.md 3.4, D2): shop nào bị khoá, shop nào được
// mở lại (bảng điều kiện), actor và lý do của từng lần chuyển. Khoá hàng thật, thứ tự và đua nhau do
// admin-user-shop-cascade.int-spec.ts kiểm trên Postgres.
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const T0 = new Date('2026-10-20T00:00:00.000Z');
const BEFORE = new Date('2026-10-19T23:59:59.999Z');
const AFTER = new Date('2026-10-20T00:00:00.001Z');

interface HistoryRow {
  actorType: 'OWNER' | 'ADMIN' | 'SYSTEM';
  toStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  note: string | null;
  createdAt: Date;
}

const cascadeRow = (createdAt: Date): HistoryRow => ({
  actorType: 'SYSTEM',
  toStatus: 'SUSPENDED',
  note: SHOP_CASCADE_SUSPEND_REASON,
  createdAt,
});

function build(options: { lockedIds?: string[] } = {}) {
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue((options.lockedIds ?? []).map((id) => ({ id }))),
    shop: { findMany: jest.fn(), count: jest.fn() },
  };
  const shopStatus = { transition: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminUserShopCascadeService(
    shopStatus as unknown as ShopStatusService,
  );
  return { service, tx: tx as unknown as TxClient, raw: tx, shopStatus };
}

describe('AdminUserShopCascadeService', () => {
  describe('suspendOwnedShops (khoá / cấm tài khoản)', () => {
    it('khoá hàng các shop APPROVED của chủ bằng FOR UPDATE, theo id (tránh deadlock), giá trị chỉ là tham số', async () => {
      const { service, tx, raw } = build();

      await service.suspendOwnedShops(tx, OWNER_ID);

      const [query] = raw.$queryRaw.mock.calls[0] as [Prisma.Sql];
      expect(query.text).toMatch(
        /FROM shops WHERE owner_id = \$1 AND status = \$2::"ShopStatus" ORDER BY id FOR UPDATE$/,
      );
      expect(query.values).toEqual([OWNER_ID, 'APPROVED']);
    });

    it('chuyển MỖI shop APPROVED → SUSPENDED bằng actor SYSTEM, lý do là MÃ cascade, trên CHÍNH tx', async () => {
      const { service, tx, shopStatus } = build({ lockedIds: ['s1', 's2'] });

      const count = await service.suspendOwnedShops(tx, OWNER_ID);

      expect(count).toBe(2);
      expect(shopStatus.transition).toHaveBeenCalledTimes(2);
      for (const id of ['s1', 's2']) {
        expect(shopStatus.transition).toHaveBeenCalledWith(
          tx,
          id,
          'APPROVED',
          'SUSPENDED',
          { type: 'SYSTEM' },
          SHOP_CASCADE_SUSPEND_REASON,
        );
      }
    });

    it('không có shop APPROVED nào ⇒ 0 và không chuyển gì', async () => {
      const { service, tx, shopStatus } = build({ lockedIds: [] });

      expect(await service.suspendOwnedShops(tx, OWNER_ID)).toBe(0);
      expect(shopStatus.transition).not.toHaveBeenCalled();
    });

    it('một lần chuyển lỗi ⇒ lỗi lan ra (để transaction của người gọi rollback), không nuốt', async () => {
      const { service, tx, shopStatus } = build({ lockedIds: ['s1', 's2'] });
      shopStatus.transition.mockRejectedValueOnce(new Error('boom'));

      await expect(service.suspendOwnedShops(tx, OWNER_ID)).rejects.toThrow(
        'boom',
      );
      expect(shopStatus.transition).toHaveBeenCalledTimes(1);
    });
  });

  describe('reopenCascadeSuspendedShops (mở lại từ tạm khoá)', () => {
    // Mỗi ca: dòng lịch sử MỚI NHẤT của một shop đang SUSPENDED + mốc `lockStartedAt` của tài khoản ⇒ có được mở lại không.
    const cases: [string, HistoryRow | null, Date | null, boolean][] = [
      ['dòng cascade ghi đúng lúc tài khoản bị khoá', cascadeRow(T0), T0, true],
      [
        'dòng cascade ghi SAU lúc tài khoản bị khoá',
        cascadeRow(AFTER),
        T0,
        true,
      ],
      [
        'dòng cascade của lần khoá CŨ (trước mốc khoá hiện tại) — vd khoá → cấm → mở → khoá lại',
        cascadeRow(BEFORE),
        T0,
        false,
      ],
      [
        'Admin đã tự khoá shop (dòng mới nhất là ADMIN)',
        { ...cascadeRow(AFTER), actorType: 'ADMIN', note: 'Vi phạm' },
        T0,
        false,
      ],
      [
        'SYSTEM nhưng ghi chú khác mã cascade',
        { ...cascadeRow(AFTER), note: 'MIGRATION_BACKFILL' },
        T0,
        false,
      ],
      [
        'SYSTEM, đúng mã nhưng KHÔNG phải dòng chuyển sang SUSPENDED',
        { ...cascadeRow(AFTER), toStatus: 'APPROVED' },
        T0,
        false,
      ],
      [
        'chủ shop (OWNER) là người đổi gần nhất',
        { ...cascadeRow(AFTER), actorType: 'OWNER' },
        T0,
        false,
      ],
      ['shop không có dòng lịch sử nào', null, T0, false],
      [
        'không có mốc khoá (dữ liệu dựng tay) ⇒ chỉ xét dòng mới nhất',
        cascadeRow(BEFORE),
        null,
        true,
      ],
    ];

    it.each(cases)(
      '%s ⇒ mở lại: %s',
      async (_name, latest, lockStartedAt, reopened) => {
        const { service, tx, raw, shopStatus } = build({ lockedIds: ['s1'] });
        raw.shop.findMany.mockResolvedValue([
          { id: 's1', statusHistory: latest ? [latest] : [] },
        ]);

        const count = await service.reopenCascadeSuspendedShops(
          tx,
          OWNER_ID,
          lockStartedAt,
        );

        expect(count).toBe(reopened ? 1 : 0);
        if (reopened) {
          // Mở lại KHÔNG mang lý do (APPROVED luôn xoá lý do) và cũng actor SYSTEM.
          expect(shopStatus.transition).toHaveBeenCalledWith(
            tx,
            's1',
            'SUSPENDED',
            'APPROVED',
            { type: 'SYSTEM' },
          );
        } else {
          expect(shopStatus.transition).not.toHaveBeenCalled();
        }
      },
    );

    it('nhiều shop: chỉ mở lại những shop đủ điều kiện, giữ nguyên phần còn lại', async () => {
      const { service, tx, raw, shopStatus } = build({
        lockedIds: ['cascade', 'manual', 'old'],
      });
      raw.shop.findMany.mockResolvedValue([
        { id: 'cascade', statusHistory: [cascadeRow(AFTER)] },
        {
          id: 'manual',
          statusHistory: [{ ...cascadeRow(AFTER), actorType: 'ADMIN' }],
        },
        { id: 'old', statusHistory: [cascadeRow(BEFORE)] },
      ]);

      const count = await service.reopenCascadeSuspendedShops(tx, OWNER_ID, T0);

      expect(count).toBe(1);
      expect(shopStatus.transition).toHaveBeenCalledTimes(1);
      expect((shopStatus.transition.mock.calls as unknown[][])[0][1]).toBe(
        'cascade',
      );
    });

    it('khoá hàng shop SUSPENDED của chủ bằng FOR UPDATE rồi chỉ đọc DÒNG LỊCH SỬ MỚI NHẤT (take 1, createdAt giảm dần, id làm khoá phụ)', async () => {
      const { service, tx, raw } = build({ lockedIds: ['s1'] });
      raw.shop.findMany.mockResolvedValue([{ id: 's1', statusHistory: [] }]);

      await service.reopenCascadeSuspendedShops(tx, OWNER_ID, T0);

      const [query] = raw.$queryRaw.mock.calls[0] as [Prisma.Sql];
      expect(query.text).toMatch(/FOR UPDATE$/);
      expect(query.values).toEqual([OWNER_ID, 'SUSPENDED']);
      const args = (
        raw.shop.findMany.mock.calls as [Prisma.ShopFindManyArgs][]
      )[0][0];
      expect(args.where).toEqual({ id: { in: ['s1'] } });
      expect(args.select).toMatchObject({
        statusHistory: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      });
    });

    it('không có shop SUSPENDED nào ⇒ 0, không đọc lịch sử, không chuyển gì', async () => {
      const { service, tx, raw, shopStatus } = build({ lockedIds: [] });

      expect(await service.reopenCascadeSuspendedShops(tx, OWNER_ID, T0)).toBe(
        0,
      );
      expect(raw.shop.findMany).not.toHaveBeenCalled();
      expect(shopStatus.transition).not.toHaveBeenCalled();
    });

    it('một lần chuyển lỗi ⇒ lỗi lan ra, không nuốt', async () => {
      const { service, tx, raw, shopStatus } = build({ lockedIds: ['s1'] });
      raw.shop.findMany.mockResolvedValue([
        { id: 's1', statusHistory: [cascadeRow(AFTER)] },
      ]);
      shopStatus.transition.mockRejectedValueOnce(new Error('boom'));

      await expect(
        service.reopenCascadeSuspendedShops(tx, OWNER_ID, T0),
      ).rejects.toThrow('boom');
    });
  });

  describe('countSuspendedShops (mở lại từ bị cấm)', () => {
    it('đếm shop SUSPENDED của đúng chủ tài khoản và KHÔNG chuyển shop nào', async () => {
      const { service, tx, raw, shopStatus } = build();
      raw.shop.count.mockResolvedValue(3);

      expect(await service.countSuspendedShops(tx, OWNER_ID)).toBe(3);
      expect(raw.shop.count).toHaveBeenCalledWith({
        where: { ownerId: OWNER_ID, status: 'SUSPENDED' },
      });
      expect(shopStatus.transition).not.toHaveBeenCalled();
    });
  });
});
