import { cartItemInputSchema, type CartItemInput } from '@ecommerce/types';
import { z } from 'zod';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const CART_STORAGE_KEY = 'ecommerce-guest-cart';

// Dữ liệu đọc từ localStorage là input từ bên ngoài (người dùng/extension có
// thể sửa, phiên bản cũ có thể khác shape) nên phải validate bằng Zod trước
// khi dùng (rules/general.md mục 4) — sai shape thì bỏ, coi như giỏ trống.
const persistedCartSchema = z.object({ items: z.array(cartItemInputSchema) });

interface CartState {
  // Giỏ hàng CỦA GUEST — chỉ giữ {productVariantId, quantity}, KHÔNG lưu
  // giá/tên/tồn kho (luôn lấy live từ BE qua POST /cart/quote, Week6.md 1.2/
  // 1.8). Đây là ngoại lệ có chủ đích của quy tắc "server data không vào
  // Zustand" (rules/frontend.md mục 3): dữ liệu này CHƯA thuộc về server khi
  // còn là guest. Sau khi đăng nhập mọi thao tác đi qua API và store này
  // không còn được đọc/ghi (đã merge rồi clear).
  items: CartItemInput[];
  // Store bật skipHydration: state ban đầu (client) phải giống HTML server
  // (rỗng) để không lệch hydration, rồi mới đọc localStorage trong effect —
  // xem hydrateCartStore. Component dựa vào items (vd badge số lượng) phải
  // chờ hasHydrated === true, nếu không sẽ hiện giỏ trống sai trong 1 nhịp.
  hasHydrated: boolean;
  addItem: (productVariantId: string, quantity?: number) => void;
  setQuantity: (productVariantId: string, quantity: number) => void;
  removeItem: (productVariantId: string) => void;
  clear: () => void;
}

// Số lượng luôn là số nguyên ≥ 1; giá trị rác (NaN, âm, 0) bị bỏ qua thay vì
// ghi vào giỏ — BE cũng chặn (min 1) nhưng không nên gửi dữ liệu hỏng lên.
function toValidQuantity(quantity: number): number | null {
  const value = Math.floor(quantity);
  return Number.isFinite(value) && value >= 1 ? value : null;
}

// Gộp các dòng trùng variant (dữ liệu lưu tay/cũ có thể lặp) — cùng quy tắc
// với BE: cộng dồn theo productVariantId.
function mergeDuplicates(items: CartItemInput[]): CartItemInput[] {
  const totals = new Map<string, number>();
  for (const { productVariantId, quantity } of items) {
    totals.set(productVariantId, (totals.get(productVariantId) ?? 0) + quantity);
  }
  return [...totals].map(([productVariantId, quantity]) => ({ productVariantId, quantity }));
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      hasHydrated: false,
      // Đã có variant trong giỏ thì cộng dồn (giống POST /cart/items).
      addItem: (productVariantId, quantity = 1) => {
        const valid = toValidQuantity(quantity);
        if (valid === null) return;
        set((state) => {
          const existing = state.items.find((item) => item.productVariantId === productVariantId);
          return {
            items: existing
              ? state.items.map((item) =>
                  item.productVariantId === productVariantId
                    ? { ...item, quantity: item.quantity + valid }
                    : item,
                )
              : [...state.items, { productVariantId, quantity: valid }],
          };
        });
      },
      // Đặt số lượng mới (không cộng dồn), giống PATCH /cart/items/:itemId:
      // < 1 thì bỏ dòng khỏi giỏ; variant chưa có trong giỏ thì không làm gì.
      setQuantity: (productVariantId, quantity) => {
        const valid = toValidQuantity(quantity);
        if (valid === null) {
          set((state) => ({
            items: state.items.filter((item) => item.productVariantId !== productVariantId),
          }));
          return;
        }
        set((state) => ({
          items: state.items.map((item) =>
            item.productVariantId === productVariantId ? { ...item, quantity: valid } : item,
          ),
        }));
      },
      removeItem: (productVariantId) =>
        set((state) => ({
          items: state.items.filter((item) => item.productVariantId !== productVariantId),
        })),
      clear: () => set({ items: [] }),
    }),
    {
      name: CART_STORAGE_KEY,
      // createJSONStorage tự bắt lỗi khi truy cập localStorage bị chặn (chế độ
      // riêng tư, tắt site data...) — lúc đó store chạy thuần trong bộ nhớ.
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      // Chỉ lưu items, không lưu hasHydrated/hàm.
      partialize: (state) => ({ items: state.items }),
      merge: (persisted, current) => {
        const parsed = persistedCartSchema.safeParse(persisted);
        return parsed.success ? { ...current, items: mergeDuplicates(parsed.data.items) } : current;
      },
    },
  ),
);

// Gọi 1 lần ở client sau khi mount (effect) — đọc localStorage vào store rồi
// đánh dấu hasHydrated. Luôn đặt hasHydrated ngay cả khi storage không dùng
// được (rehydrate no-op), để UI không treo mãi ở trạng thái chờ.
export async function hydrateCartStore(): Promise<void> {
  try {
    await useCartStore.persist.rehydrate();
  } finally {
    useCartStore.setState({ hasHydrated: true });
  }
}
