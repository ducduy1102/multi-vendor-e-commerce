import { ApiError } from '@/shared/lib/api-client';

// Lỗi 4xx (chưa đăng nhập, đơn không tồn tại/không phải của bạn...) là kết quả chắc chắn, thử lại
// vô ích. Mọi lỗi khác (5xx, mất mạng `status: 0`, lỗi không phải ApiError) có thể tạm thời nên chỉ
// thử lại tối đa 2 lần — không treo mãi ở "Đang tải...". Dùng làm `retry` của useQuery.
export function shouldRetryQuery(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}
