import {
  canActorTransitionShop,
  SHOP_STATUS_TRANSITIONS,
  shopActorTypeSchema,
  shopStatusSchema,
} from '@ecommerce/types';
import type { ShopStatus } from '@prisma/client';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import type { TxClient } from '../../shared/prisma/tx-client';
import { ShopStatusService, type ShopActor } from './shop-status.service';

// Matcher lồng trong object literal trả `any` — ép kiểu 1 lần ở đây thay vì để `any` rò rỉ ra từng chỗ
// dùng (@typescript-eslint/no-unsafe-assignment).
const anyDate = expect.any(Date) as unknown;
const containing = (fields: Record<string, unknown>) =>
  expect.objectContaining(fields) as unknown;

const SHOP_ID = 'shop-1';

const ADMIN: ShopActor = { type: 'ADMIN', id: 'admin-1' };
const OWNER: ShopActor = { type: 'OWNER', id: 'owner-1' };
const SYSTEM: ShopActor = { type: 'SYSTEM' };
const ACTOR_BY_TYPE = { ADMIN, OWNER, SYSTEM } as const;

describe('ShopStatusService', () => {
  let service: ShopStatusService;
  let tx: {
    shop: { updateMany: jest.Mock };
    shopStatusHistory: { create: jest.Mock };
  };

  beforeEach(() => {
    tx = {
      shop: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      shopStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new ShopStatusService();
  });

  const run = (
    from: ShopStatus,
    to: ShopStatus,
    actor: ShopActor,
    reason?: string | null,
  ) =>
    service.transition(
      tx as unknown as TxClient,
      SHOP_ID,
      from,
      to,
      actor,
      reason,
    );

  const untouched = () => {
    expect(tx.shop.updateMany).not.toHaveBeenCalled();
    expect(tx.shopStatusHistory.create).not.toHaveBeenCalled();
  };

  describe('transition — kiểm cạnh + actor TRƯỚC khi chạm DB', () => {
    // TOÀN BỘ ma trận actor × from × to không có trong bảng (40 ô) — không chỉ vài ô đại diện.
    const forbidden = shopActorTypeSchema.options.flatMap((actorType) =>
      shopStatusSchema.options.flatMap((from) =>
        shopStatusSchema.options
          .filter((to) => !canActorTransitionShop(actorType, from, to))
          .map((to) => [actorType, from, to] as const),
      ),
    );

    it('ma trận bị cấm không rỗng và không chứa cạnh nào của bảng', () => {
      expect(forbidden).toHaveLength(
        shopActorTypeSchema.options.length *
          shopStatusSchema.options.length ** 2 -
          SHOP_STATUS_TRANSITIONS.length,
      );
    });

    it.each(forbidden)(
      '%s: %s → %s ⇒ 409 SHOP_INVALID_TRANSITION, không chạm DB',
      async (actorType, from, to) => {
        await expectAppException(
          run(from, to, ACTOR_BY_TYPE[actorType], 'lý do'),
          {
            status: 409,
            code: 'SHOP_INVALID_TRANSITION',
            message: `Cannot change shop status from ${from} to ${to}`,
          },
        );
        untouched();
      },
    );

    it('Admin KHÔNG làm được cạnh của chủ shop (REJECTED → PENDING), chủ shop KHÔNG tự duyệt (PENDING → APPROVED)', async () => {
      await expectAppException(run('REJECTED', 'PENDING', ADMIN), {
        status: 409,
        code: 'SHOP_INVALID_TRANSITION',
      });
      await expectAppException(run('PENDING', 'APPROVED', OWNER), {
        status: 409,
        code: 'SHOP_INVALID_TRANSITION',
      });
      untouched();
    });
  });

  describe('transition — cạnh hợp lệ', () => {
    const validEdges = SHOP_STATUS_TRANSITIONS.map(
      (edge) => [edge.from, edge.to, edge.actor] as const,
    );

    it.each(validEdges)(
      '%s → %s (%s): UPDATE có điều kiện status cũ, rồi ghi đúng 1 dòng history',
      async (from, to, actorType) => {
        const actor = ACTOR_BY_TYPE[actorType];
        const carriesReason = to === 'REJECTED' || to === 'SUSPENDED';

        await run(from, to, actor, 'lý do');

        expect(tx.shop.updateMany).toHaveBeenCalledTimes(1);
        expect(tx.shop.updateMany).toHaveBeenCalledWith({
          where: { id: SHOP_ID, status: from },
          data: {
            status: to,
            statusReason: carriesReason ? 'lý do' : null,
            statusChangedAt: anyDate,
          },
        });
        expect(tx.shopStatusHistory.create).toHaveBeenCalledTimes(1);
        expect(tx.shopStatusHistory.create).toHaveBeenCalledWith({
          data: {
            shopId: SHOP_ID,
            fromStatus: from,
            toStatus: to,
            actorType,
            actorId: actor.type === 'SYSTEM' ? null : actor.id,
            note: carriesReason ? 'lý do' : null,
            createdAt: anyDate,
          },
        });
      },
    );

    it('statusChangedAt và history.createdAt là CÙNG 1 mốc (cột phi chuẩn luôn bằng history mới nhất)', async () => {
      await run('PENDING', 'REJECTED', ADMIN, 'Thiếu giấy phép');

      const [{ data: update }] = tx.shop.updateMany.mock.calls[0] as [
        { data: { statusChangedAt: Date } },
      ];
      const [{ data: history }] = tx.shopStatusHistory.create.mock.calls[0] as [
        { data: { createdAt: Date } },
      ];
      expect(history.createdAt).toBe(update.statusChangedAt);
    });

    it('ghi history SAU khi UPDATE thành công (thứ tự: updateMany rồi create)', async () => {
      const order: string[] = [];
      tx.shop.updateMany.mockImplementation(() => {
        order.push('updateMany');
        return Promise.resolve({ count: 1 });
      });
      tx.shopStatusHistory.create.mockImplementation(() => {
        order.push('history');
        return Promise.resolve({});
      });

      await run('APPROVED', 'SUSPENDED', ADMIN, 'Vi phạm');

      expect(order).toEqual(['updateMany', 'history']);
    });
  });

  describe('transition — lý do', () => {
    it.each<[ShopStatus, ShopStatus, ShopActor]>([
      ['PENDING', 'REJECTED', ADMIN],
      ['APPROVED', 'SUSPENDED', ADMIN],
    ])(
      '%s → %s mang lý do: lưu cả statusReason lẫn note (lý do seller nhìn thấy)',
      async (from, to, actor) => {
        await run(from, to, actor, 'Hàng cấm');

        expect(tx.shop.updateMany).toHaveBeenCalledWith(
          containing({
            data: containing({ statusReason: 'Hàng cấm' }),
          }),
        );
        expect(tx.shopStatusHistory.create).toHaveBeenCalledWith({
          data: containing({ note: 'Hàng cấm' }),
        });
      },
    );

    it.each([undefined, null, '', '   '])(
      'từ chối/khoá thiếu lý do (%j) ⇒ lỗi lập trình, không chạm DB (note chỉ chứa lý do thật)',
      async (reason) => {
        await expect(run('PENDING', 'REJECTED', ADMIN, reason)).rejects.toThrow(
          'A reason is required to move a shop to REJECTED',
        );
        await expect(
          run('APPROVED', 'SUSPENDED', ADMIN, reason),
        ).rejects.toThrow('A reason is required to move a shop to SUSPENDED');
        untouched();
      },
    );

    it.each<[ShopStatus, ShopStatus, ShopActor]>([
      ['PENDING', 'APPROVED', ADMIN],
      ['SUSPENDED', 'APPROVED', ADMIN],
      ['REJECTED', 'PENDING', OWNER],
    ])(
      '%s → %s: duyệt/mở khoá/nộp lại xoá lý do — lý do gửi kèm bị bỏ qua ở CẢ statusReason và note',
      async (from, to, actor) => {
        await run(from, to, actor, 'không được lưu');

        expect(tx.shop.updateMany).toHaveBeenCalledWith(
          containing({
            data: containing({ statusReason: null }),
          }),
        );
        expect(tx.shopStatusHistory.create).toHaveBeenCalledWith({
          data: containing({ note: null }),
        });
      },
    );

    it('nộp lại không cần lý do (reason undefined) vẫn chạy bình thường', async () => {
      await expect(run('REJECTED', 'PENDING', OWNER)).resolves.toBeUndefined();
      expect(tx.shopStatusHistory.create).toHaveBeenCalledWith({
        data: containing({
          actorType: 'OWNER',
          actorId: 'owner-1',
          note: null,
        }),
      });
    });
  });

  describe('transition — thua race / shop không còn ở trạng thái cũ', () => {
    it('UPDATE không lật được dòng nào ⇒ 409 SHOP_INVALID_TRANSITION và KHÔNG ghi history', async () => {
      tx.shop.updateMany.mockResolvedValue({ count: 0 });

      await expectAppException(run('PENDING', 'APPROVED', ADMIN), {
        status: 409,
        code: 'SHOP_INVALID_TRANSITION',
        message: 'Cannot change shop status from PENDING to APPROVED',
      });

      expect(tx.shop.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.shopStatusHistory.create).not.toHaveBeenCalled();
    });

    it('ghi history lỗi ⇒ lỗi lan ra để transaction của người gọi rollback (không nuốt)', async () => {
      tx.shopStatusHistory.create.mockRejectedValue(new Error('db down'));

      await expect(run('PENDING', 'APPROVED', ADMIN)).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('recordCreated — mốc tạo shop', () => {
    const shop = {
      id: SHOP_ID,
      status: 'PENDING' as ShopStatus,
      createdAt: new Date('2026-10-04T01:02:03.000Z'),
    };

    it('ghi null → trạng thái hiện tại, createdAt = đúng shop.createdAt, note null, actor OWNER có id', async () => {
      await service.recordCreated(tx as unknown as TxClient, shop, OWNER);

      expect(tx.shopStatusHistory.create).toHaveBeenCalledWith({
        data: {
          shopId: SHOP_ID,
          fromStatus: null,
          toStatus: 'PENDING',
          actorType: 'OWNER',
          actorId: 'owner-1',
          note: null,
          createdAt: shop.createdAt,
        },
      });
      // Chỉ ghi history: không đụng vào bảng shops.
      expect(tx.shop.updateMany).not.toHaveBeenCalled();
    });

    it('actor SYSTEM không có actorId', async () => {
      await service.recordCreated(tx as unknown as TxClient, shop, SYSTEM);

      expect(tx.shopStatusHistory.create).toHaveBeenCalledWith({
        data: containing({ actorType: 'SYSTEM', actorId: null }),
      });
    });
  });
});
