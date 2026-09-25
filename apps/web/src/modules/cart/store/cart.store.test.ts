import { afterEach, describe, expect, it, vi } from 'vitest';

import { CART_STORAGE_KEY, hydrateCartStore, useCartStore } from './cart.store';

function state() {
  return useCartStore.getState();
}

function stored(): unknown {
  const raw = localStorage.getItem(CART_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe('useCartStore', () => {
  afterEach(() => {
    localStorage.clear();
    useCartStore.setState({ items: [], hasHydrated: false });
    vi.restoreAllMocks();
  });

  it('bắt đầu với giỏ trống, chưa hydrate', () => {
    expect(state().items).toEqual([]);
    expect(state().hasHydrated).toBe(false);
  });

  describe('addItem', () => {
    it('thêm variant mới với số lượng mặc định 1', () => {
      state().addItem('v1');

      expect(state().items).toEqual([{ productVariantId: 'v1', quantity: 1 }]);
    });

    it('variant đã có thì cộng dồn số lượng', () => {
      state().addItem('v1', 2);
      state().addItem('v1', 3);

      expect(state().items).toEqual([{ productVariantId: 'v1', quantity: 5 }]);
    });

    it('giữ thứ tự thêm giữa nhiều variant', () => {
      state().addItem('v1');
      state().addItem('v2');
      state().addItem('v1');

      expect(state().items.map((i) => i.productVariantId)).toEqual(['v1', 'v2']);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      'số lượng không hợp lệ (%s) bị bỏ qua',
      (quantity) => {
        state().addItem('v1', quantity);

        expect(state().items).toEqual([]);
      },
    );

    it('số lượng thập phân được làm tròn xuống', () => {
      state().addItem('v1', 2.9);

      expect(state().items[0].quantity).toBe(2);
    });
  });

  describe('setQuantity', () => {
    it('đặt số lượng mới (không cộng dồn)', () => {
      state().addItem('v1', 5);

      state().setQuantity('v1', 2);

      expect(state().items).toEqual([{ productVariantId: 'v1', quantity: 2 }]);
    });

    it('số lượng < 1 thì bỏ dòng khỏi giỏ', () => {
      state().addItem('v1', 5);
      state().addItem('v2');

      state().setQuantity('v1', 0);

      expect(state().items).toEqual([{ productVariantId: 'v2', quantity: 1 }]);
    });

    it('variant chưa có trong giỏ thì không tự thêm', () => {
      state().setQuantity('ghost', 3);

      expect(state().items).toEqual([]);
    });
  });

  it('removeItem chỉ bỏ đúng variant đó, không lỗi khi không có', () => {
    state().addItem('v1');
    state().addItem('v2');

    state().removeItem('v1');
    state().removeItem('ghost');

    expect(state().items).toEqual([{ productVariantId: 'v2', quantity: 1 }]);
  });

  it('clear xoá sạch giỏ', () => {
    state().addItem('v1');
    state().addItem('v2');

    state().clear();

    expect(state().items).toEqual([]);
  });

  describe('lưu localStorage', () => {
    it('chỉ lưu items, không lưu giá/tên hay cờ hasHydrated', () => {
      state().addItem('v1', 2);

      expect(stored()).toEqual({
        state: { items: [{ productVariantId: 'v1', quantity: 2 }] },
        version: 0,
      });
    });

    it('xoá giỏ cũng cập nhật localStorage', () => {
      state().addItem('v1');

      state().clear();

      expect(stored()).toMatchObject({ state: { items: [] } });
    });
  });

  describe('hydrateCartStore', () => {
    it('đọc giỏ đã lưu vào store và bật hasHydrated', async () => {
      localStorage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify({
          state: { items: [{ productVariantId: 'v1', quantity: 3 }] },
          version: 0,
        }),
      );

      await hydrateCartStore();

      expect(state().items).toEqual([{ productVariantId: 'v1', quantity: 3 }]);
      expect(state().hasHydrated).toBe(true);
    });

    it('không có gì trong localStorage — giỏ trống nhưng vẫn hasHydrated', async () => {
      await hydrateCartStore();

      expect(state().items).toEqual([]);
      expect(state().hasHydrated).toBe(true);
    });

    it('dữ liệu sai shape bị bỏ, không làm hỏng store', async () => {
      localStorage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify({
          state: { items: [{ productVariantId: 'v1', quantity: 'nhieu' }] },
          version: 0,
        }),
      );

      await hydrateCartStore();

      expect(state().items).toEqual([]);
      expect(state().hasHydrated).toBe(true);
    });

    it('số lượng âm/0 trong dữ liệu lưu bị coi là hỏng và bỏ cả giỏ', async () => {
      localStorage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify({
          state: { items: [{ productVariantId: 'v1', quantity: 0 }] },
          version: 0,
        }),
      );

      await hydrateCartStore();

      expect(state().items).toEqual([]);
    });

    it('JSON hỏng trong localStorage không làm văng lỗi, vẫn hasHydrated', async () => {
      localStorage.setItem(CART_STORAGE_KEY, '{không phải json');

      await expect(hydrateCartStore()).resolves.toBeUndefined();

      expect(state().items).toEqual([]);
      expect(state().hasHydrated).toBe(true);
    });

    it('gộp các dòng trùng variant trong dữ liệu đã lưu', async () => {
      localStorage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify({
          state: {
            items: [
              { productVariantId: 'v1', quantity: 1 },
              { productVariantId: 'v1', quantity: 2 },
            ],
          },
          version: 0,
        }),
      );

      await hydrateCartStore();

      expect(state().items).toEqual([{ productVariantId: 'v1', quantity: 3 }]);
    });

    it('gọi nhiều lần không nhân đôi giỏ (idempotent)', async () => {
      localStorage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify({
          state: { items: [{ productVariantId: 'v1', quantity: 2 }] },
          version: 0,
        }),
      );

      await hydrateCartStore();
      await hydrateCartStore();

      expect(state().items).toEqual([{ productVariantId: 'v1', quantity: 2 }]);
    });
  });
});
