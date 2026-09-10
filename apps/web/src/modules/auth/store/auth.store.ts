import type { AuthUser } from "@ecommerce/types";
import { create } from "zustand";

interface AuthState {
  user: AuthUser | null;
  setUser: (user: AuthUser) => void;
  clearUser: () => void;
}

// Chỉ lưu user hiện tại — accessToken/refreshToken nằm trong httpOnly cookie
// do BE set (AuthController), FE không đọc/ghi/lưu token nào ở đây.
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: null }),
}));
