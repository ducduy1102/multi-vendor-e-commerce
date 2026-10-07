import type { AuthUser } from '@ecommerce/types';
import { create } from 'zustand';

interface AuthState {
  user: AuthUser | null;
  // true từ lúc app khởi động tới khi AuthHydrator biết chắc chắn kết quả
  // gọi /auth/me (dù thành công, 401, hay lỗi mạng — xem AuthHydrator.tsx).
  // `user === null` tự nó KHÔNG phân biệt được "chắc chắn chưa đăng nhập"
  // với "chưa kịp hỏi BE" — mọi nơi quyết định UI theo user null (Header,
  // BecomeSellerFormContainer...) phải chờ isHydrating === false trước,
  // nếu không sẽ hiện nhầm trạng thái Guest/chưa-xác-thực trong 1 nhịp rồi
  // mới lật đúng, gây nháy hoặc hiện sai thông báo.
  isHydrating: boolean;
  setUser: (user: AuthUser) => void;
  clearUser: () => void;
  setIsHydrating: (isHydrating: boolean) => void;
}

// Chỉ lưu user hiện tại — accessToken/refreshToken nằm trong httpOnly cookie
// do BE set (AuthController), FE không đọc/ghi/lưu token nào ở đây.
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isHydrating: true,
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: null }),
  setIsHydrating: (isHydrating) => set({ isHydrating }),
}));
