import { create } from 'zustand';

interface UIState {
  // "Sheet đang mở" của AccountSheet (shared/components/AccountSheet.tsx) —
  // nâng lên đây (module scope, ngoài cây React) vì đổi locale khiến App
  // Router remount toàn bộ cây client render trực tiếp trong
  // app/[locale]/layout.tsx (Header, BottomTabBar, AccountSheet...) — state
  // giữ bằng useState cục bộ sẽ mất, làm Sheet tự đóng khi đổi ngôn ngữ dù
  // đổi theme thì không (ThemeToggle không điều hướng, không remount).
  // Zustand store sống trong closure JS thuần nên sống sót qua remount,
  // giống hệt cách useAuthStore.user không mất khi đổi locale.
  isAccountSheetOpen: boolean;
  setAccountSheetOpen: (isAccountSheetOpen: boolean) => void;
}

// Phạm vi tối thiểu — chỉ 1 boolean cho đúng nhu cầu AccountSheet hiện tại,
// không tổng quát hoá thành store quản lý nhiều dialog/sheet khi chưa cần.
export const useUIStore = create<UIState>((set) => ({
  isAccountSheetOpen: false,
  setAccountSheetOpen: (isAccountSheetOpen) => set({ isAccountSheetOpen }),
}));
