import { useAuthStore } from '@/modules/auth';

// Đăng nhập giả cho test cần RealtimeProvider mở kết nối (nó chỉ nối khi hết hydrate VÀ có user). Chỉ dùng trong test
// (không import từ mã chạy thật). Nằm ở shared/realtime để module khác (vd chat) dựng test hook real-time mà không phải
// import `modules/auth` — module nghiệp vụ không được phụ thuộc nhau (shared/lib/module-boundaries.test.ts).
const TEST_USER = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Nguyen Van A',
  role: 'USER' as const,
  emailVerifiedAt: null,
  locale: 'vi' as const,
  hasPassword: true,
};

export function signInForRealtimeTest(): void {
  useAuthStore.setState({ user: TEST_USER, isHydrating: false });
}

// Gọi SAU `cleanup()` của RTL: reset khi component còn mount làm React cập nhật ngoài act().
export function signOutAfterRealtimeTest(): void {
  useAuthStore.setState({ user: null, isHydrating: true });
}
