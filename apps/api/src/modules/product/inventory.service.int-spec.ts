import { PrismaClient } from '@prisma/client';
import {
  cleanupByTag,
  createShopWithProduct,
  createVariant,
} from '../../shared/testing/db-fixtures';
import type { TxClient } from '../../shared/prisma/tx-client';
import {
  InsufficientStockError,
  InventoryInvariantError,
  InventoryService,
} from './inventory.service';

// Integration test trên DB dev THẬT (cần Postgres đang chạy): kiểm SQL `reserved_stock`, CHECK
// constraint và tranh chấp đồng thời mà unit test với tx giả không chứng minh được.
// Chạy: `pnpm test:int`. Dữ liệu mang tiền tố TAG và được dọn sau khi xong.
const TAG = 'it-inv-';

describe('InventoryService (DB thật)', () => {
  const prisma = new PrismaClient();
  const service = new InventoryService();
  let base: { shopId: string; productId: string };

  const run = <T>(fn: (tx: TxClient) => Promise<T>) =>
    prisma.$transaction((tx) => fn(tx));
  const stockOf = (id: string) =>
    prisma.productVariant.findUniqueOrThrow({
      where: { id },
      select: { stock: true, reservedStock: true },
    });

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    base = await createShopWithProduct(prisma, TAG);
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  it('reserve: tăng reservedStock, giữ nguyên stock vật lý, trả giá hiện tại', async () => {
    const v = await createVariant(prisma, base, { stock: 10, price: 123000 });

    const prices = await run((tx) =>
      service.reserve(tx, [{ productVariantId: v.id, quantity: 3 }]),
    );

    expect(prices.get(v.id)?.toString()).toBe('123000');
    expect(await stockOf(v.id)).toEqual({ stock: 10, reservedStock: 3 });
  });

  it('reserve: variant thiếu — ném đủ danh sách và ROLLBACK cả variant đã giữ chỗ được', async () => {
    const ok = await createVariant(prisma, base, { stock: 10 });
    const low = await createVariant(prisma, base, { stock: 2 });
    const off = await createVariant(prisma, base, { stock: 9 });
    await prisma.productVariant.update({
      where: { id: off.id },
      data: { isActive: false },
    });

    const error = await run((tx) =>
      service.reserve(tx, [
        { productVariantId: ok.id, quantity: 1 },
        { productVariantId: low.id, quantity: 5 },
        { productVariantId: off.id, quantity: 1 },
      ]),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InsufficientStockError);
    const shortages = (error as InsufficientStockError).shortages;
    expect(shortages).toEqual(
      expect.arrayContaining([
        { productVariantId: low.id, requested: 5, available: 2 },
        { productVariantId: off.id, requested: 1, available: 0 },
      ]),
    );
    expect(shortages).toHaveLength(2);
    // Variant "ok" đã giữ chỗ được trong transaction nhưng phải bị rollback.
    expect((await stockOf(ok.id)).reservedStock).toBe(0);
  });

  it('reserve tính theo available: phần đã giữ chỗ không bán lần 2', async () => {
    const v = await createVariant(prisma, base, { stock: 5, reservedStock: 4 });

    await expect(
      run((tx) =>
        service.reserve(tx, [{ productVariantId: v.id, quantity: 2 }]),
      ),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    await run((tx) =>
      service.reserve(tx, [{ productVariantId: v.id, quantity: 1 }]),
    );
    expect(await stockOf(v.id)).toEqual({ stock: 5, reservedStock: 5 });
  });

  it('commit: stock và reservedStock cùng giảm (available không đổi); replay bị từ chối, không trừ lần 2', async () => {
    const v = await createVariant(prisma, base, {
      stock: 10,
      reservedStock: 3,
    });
    const lines = [{ productVariantId: v.id, quantity: 3 }];

    await run((tx) => service.commit(tx, lines));
    expect(await stockOf(v.id)).toEqual({ stock: 7, reservedStock: 0 });

    await expect(run((tx) => service.commit(tx, lines))).rejects.toBeInstanceOf(
      InventoryInvariantError,
    );
    expect(await stockOf(v.id)).toEqual({ stock: 7, reservedStock: 0 });
  });

  it('release: chỉ nhả giữ chỗ, stock vật lý giữ nguyên; nhả lần 2 bị từ chối', async () => {
    const v = await createVariant(prisma, base, {
      stock: 10,
      reservedStock: 3,
    });
    const lines = [{ productVariantId: v.id, quantity: 3 }];

    await run((tx) => service.release(tx, lines));
    expect(await stockOf(v.id)).toEqual({ stock: 10, reservedStock: 0 });

    await expect(
      run((tx) => service.release(tx, lines)),
    ).rejects.toBeInstanceOf(InventoryInvariantError);
  });

  it('restock: cộng lại stock vật lý, giữ nguyên reservedStock; reserve → commit → restock trả đúng số ban đầu', async () => {
    const v = await createVariant(prisma, base, { stock: 10 });
    const lines = [{ productVariantId: v.id, quantity: 2 }];

    await run((tx) => service.reserve(tx, lines));
    await run((tx) => service.commit(tx, lines));
    expect(await stockOf(v.id)).toEqual({ stock: 8, reservedStock: 0 });

    await run((tx) => service.restock(tx, lines));
    expect(await stockOf(v.id)).toEqual({ stock: 10, reservedStock: 0 });
  });

  it('restock không động tới reservedStock của người khác đang giữ chỗ (CHECK reserved <= stock vẫn đúng)', async () => {
    const v = await createVariant(prisma, base, { stock: 5, reservedStock: 5 });

    await run((tx) =>
      service.restock(tx, [{ productVariantId: v.id, quantity: 3 }]),
    );

    expect(await stockOf(v.id)).toEqual({ stock: 8, reservedStock: 5 });
  });

  it('restock: variant không tồn tại — ném và ROLLBACK cả variant đã cộng trước đó', async () => {
    const a = await createVariant(prisma, base, { stock: 5 });

    await expect(
      run((tx) =>
        service.restock(tx, [
          { productVariantId: a.id, quantity: 2 },
          { productVariantId: `zzz-${a.id}`, quantity: 1 }, // id lớn hơn ⇒ xử lý sau a
        ]),
      ),
    ).rejects.toBeInstanceOf(InventoryInvariantError);
    expect((await stockOf(a.id)).stock).toBe(5);
  });

  it('commit/release lỗi giữa chừng thì rollback cả các variant đã xử lý trước đó', async () => {
    const a = await createVariant(prisma, base, { stock: 5, reservedStock: 2 });
    const b = await createVariant(prisma, base, { stock: 5, reservedStock: 0 });

    await expect(
      run((tx) =>
        service.release(tx, [
          { productVariantId: a.id, quantity: 2 },
          { productVariantId: b.id, quantity: 1 },
        ]),
      ),
    ).rejects.toBeInstanceOf(InventoryInvariantError);
    expect((await stockOf(a.id)).reservedStock).toBe(2);
  });

  describe('CHECK constraint ở DB (lưới an toàn cuối)', () => {
    it.each([
      ['reserved_stock > stock', 'reserved_stock = stock + 1'],
      ['reserved_stock < 0', 'reserved_stock = -1'],
      ['stock < 0', 'stock = -1'],
    ])('từ chối ghi %s', async (_label, setClause) => {
      const v = await createVariant(prisma, base, { stock: 5 });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE product_variants SET ${setClause} WHERE id = '${v.id}'`,
        ),
      ).rejects.toThrow(/check constraint|violates/i);
    });
  });

  describe('đồng thời', () => {
    it('10 checkout song song cùng giành 5 sản phẩm: đúng 5 thành công, không bao giờ oversell', async () => {
      const v = await createVariant(prisma, base, { stock: 5 });

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          run((tx) =>
            service.reserve(tx, [{ productVariantId: v.id, quantity: 1 }]),
          ),
        ),
      );

      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(ok).toBe(5);
      expect(
        rejected.every((r) => r.reason instanceof InsufficientStockError),
      ).toBe(true);
      expect(await stockOf(v.id)).toEqual({ stock: 5, reservedStock: 5 });
    });

    it('2 giỏ chứa cùng 2 variant theo thứ tự ĐẢO NGƯỢC: không deadlock, mọi lần đều thành công', async () => {
      const a = await createVariant(prisma, base, { stock: 100 });
      const b = await createVariant(prisma, base, { stock: 100 });
      const forward = [
        { productVariantId: a.id, quantity: 1 },
        { productVariantId: b.id, quantity: 1 },
      ];
      const backward = [...forward].reverse();

      const results = await Promise.allSettled(
        Array.from({ length: 12 }, (_, i) =>
          run((tx) => service.reserve(tx, i % 2 === 0 ? forward : backward)),
        ),
      );

      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0);
      expect((await stockOf(a.id)).reservedStock).toBe(12);
      expect((await stockOf(b.id)).reservedStock).toBe(12);
    });
  });
});
