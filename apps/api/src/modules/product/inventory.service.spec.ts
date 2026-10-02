import { Prisma } from '@prisma/client';
import type { TxClient } from '../../shared/prisma/tx-client';
import {
  InsufficientStockError,
  InventoryInvariantError,
  InventoryService,
  normalizeLines,
} from './inventory.service';

// Unit test với `tx` GIẢ: kiểm logic điều phối (thứ tự, gộp dòng, gom lỗi, replay). SQL thật và
// tranh chấp đồng thời được kiểm ở inventory.service.int-spec.ts (DB thật, chạy bằng `pnpm test:int`).

// Với tagged template, mock nhận (strings, ...values); các hằng số dưới là vị trí của id trong `values`.
const RESERVE_ID_INDEX = 1;
const COMMIT_ID_INDEX = 2;
const RELEASE_ID_INDEX = 1;
const RESTOCK_ID_INDEX = 1;

describe('normalizeLines', () => {
  it('gộp dòng trùng variant bằng cách cộng số lượng', () => {
    expect(
      normalizeLines([
        { productVariantId: 'a', quantity: 1 },
        { productVariantId: 'a', quantity: 2 },
      ]),
    ).toEqual([{ productVariantId: 'a', quantity: 3 }]);
  });

  it('sắp theo id tăng dần bất kể thứ tự đầu vào (chống deadlock)', () => {
    const ids = normalizeLines([
      { productVariantId: 'c', quantity: 1 },
      { productVariantId: 'a', quantity: 1 },
      { productVariantId: 'b', quantity: 1 },
    ]).map((l) => l.productVariantId);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it.each([0, -1, 1.5, NaN])('số lượng %p không hợp lệ — RangeError', (q) => {
    expect(() =>
      normalizeLines([{ productVariantId: 'a', quantity: q }]),
    ).toThrow(RangeError);
  });
});

describe('InventoryService (tx giả)', () => {
  let service: InventoryService;
  let tx: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    productVariant: { findMany: jest.Mock };
  };

  beforeEach(() => {
    service = new InventoryService();
    tx = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(1),
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
    };
  });

  const asTx = () => tx as unknown as TxClient;
  const idsOf = (mock: jest.Mock, index: number) =>
    (mock.mock.calls as unknown[][]).map((call) => call[index + 1]);

  describe('reserve', () => {
    it('duyệt theo id tăng dần và trả giá đọc từ chính câu UPDATE', async () => {
      tx.$queryRaw.mockImplementation((_s: unknown, ...values: unknown[]) =>
        Promise.resolve([
          {
            id: values[RESERVE_ID_INDEX],
            price: new Prisma.Decimal(
              values[RESERVE_ID_INDEX] === 'a' ? '100' : '200',
            ),
          },
        ]),
      );

      const prices = await service.reserve(asTx(), [
        { productVariantId: 'b', quantity: 1 },
        { productVariantId: 'a', quantity: 2 },
      ]);

      expect(idsOf(tx.$queryRaw, RESERVE_ID_INDEX)).toEqual(['a', 'b']);
      expect(prices.get('a')?.toString()).toBe('100');
      expect(prices.get('b')?.toString()).toBe('200');
    });

    it('không dừng ở variant thiếu đầu tiên — ném 1 lỗi chứa đủ danh sách kèm số còn lại', async () => {
      tx.$queryRaw.mockImplementation((_s: unknown, ...values: unknown[]) =>
        Promise.resolve(
          values[RESERVE_ID_INDEX] === 'ok'
            ? [{ id: 'ok', price: new Prisma.Decimal(1) }]
            : [],
        ),
      );
      tx.productVariant.findMany.mockResolvedValue([
        { id: 'low', stock: 5, reservedStock: 4, isActive: true },
        { id: 'off', stock: 9, reservedStock: 0, isActive: false },
      ]);

      const error = await service
        .reserve(asTx(), [
          { productVariantId: 'low', quantity: 3 },
          { productVariantId: 'ok', quantity: 1 },
          { productVariantId: 'off', quantity: 1 },
          { productVariantId: 'gone', quantity: 2 },
        ])
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InsufficientStockError);
      expect((error as InsufficientStockError).shortages).toEqual([
        { productVariantId: 'gone', requested: 2, available: 0 },
        { productVariantId: 'low', requested: 3, available: 1 },
        { productVariantId: 'off', requested: 1, available: 0 },
      ]);
      expect(idsOf(tx.$queryRaw, RESERVE_ID_INDEX)).toEqual([
        'gone',
        'low',
        'off',
        'ok',
      ]);
    });

    it('dòng trùng variant được gộp thành 1 câu giữ chỗ với tổng số lượng', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: 'a', price: new Prisma.Decimal(1) },
      ]);

      await service.reserve(asTx(), [
        { productVariantId: 'a', quantity: 1 },
        { productVariantId: 'a', quantity: 4 },
      ]);

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect((tx.$queryRaw.mock.calls[0] as unknown[])[1]).toBe(4 + 1);
    });
  });

  describe('commit', () => {
    it('duyệt theo id tăng dần', async () => {
      await service.commit(asTx(), [
        { productVariantId: 'b', quantity: 1 },
        { productVariantId: 'a', quantity: 1 },
      ]);

      expect(idsOf(tx.$executeRaw, COMMIT_ID_INDEX)).toEqual(['a', 'b']);
    });

    it('variant không còn đủ giữ chỗ (replay/bất biến vỡ) — ném để rollback, không âm thầm bỏ qua', async () => {
      tx.$executeRaw.mockResolvedValue(0);

      await expect(
        service.commit(asTx(), [{ productVariantId: 'a', quantity: 1 }]),
      ).rejects.toBeInstanceOf(InventoryInvariantError);
    });
  });

  describe('release', () => {
    it('duyệt theo id tăng dần', async () => {
      await service.release(asTx(), [
        { productVariantId: 'z', quantity: 1 },
        { productVariantId: 'y', quantity: 1 },
      ]);

      expect(idsOf(tx.$executeRaw, RELEASE_ID_INDEX)).toEqual(['y', 'z']);
    });

    it('nhả quá số đang giữ chỗ — ném, không để reservedStock âm', async () => {
      tx.$executeRaw.mockResolvedValue(0);

      await expect(
        service.release(asTx(), [{ productVariantId: 'a', quantity: 1 }]),
      ).rejects.toBeInstanceOf(InventoryInvariantError);
    });
  });

  describe('restock', () => {
    it('duyệt theo id tăng dần và gộp dòng trùng variant', async () => {
      await service.restock(asTx(), [
        { productVariantId: 'z', quantity: 1 },
        { productVariantId: 'y', quantity: 2 },
        { productVariantId: 'z', quantity: 3 },
      ]);

      expect(idsOf(tx.$executeRaw, RESTOCK_ID_INDEX)).toEqual(['y', 'z']);
      expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('variant không tồn tại — ném InventoryInvariantError (rollback cả giao dịch)', async () => {
      tx.$executeRaw.mockResolvedValue(0);

      await expect(
        service.restock(asTx(), [{ productVariantId: 'a', quantity: 1 }]),
      ).rejects.toBeInstanceOf(InventoryInvariantError);
    });

    it('số lượng không hợp lệ — RangeError, không chạm DB', async () => {
      await expect(
        service.restock(asTx(), [{ productVariantId: 'a', quantity: 0 }]),
      ).rejects.toThrow(RangeError);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });
  });
});
