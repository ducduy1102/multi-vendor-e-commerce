import {
  createRealtimeHarness,
  resetRealtimeHarnessAuth,
  type RealtimeTestHarness,
} from '@/shared/realtime/test-harness';

// Khung dựng CHỈ cho test hook của module chat (không import từ mã chạy thật). Phần chung (QueryClient không thử lại +
// RealtimeProvider với socket giả) nằm ở shared/realtime/test-harness.tsx vì module thông báo cũng dùng; giữ nguyên
// tên cũ ở đây để các test chat không phải đổi.
export type ChatTestHarness = RealtimeTestHarness;
export const createChatHarness = createRealtimeHarness;
export const resetChatHarnessAuth = resetRealtimeHarnessAuth;
