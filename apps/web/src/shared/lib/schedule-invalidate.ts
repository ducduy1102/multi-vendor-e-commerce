import type { QueryClient, QueryKey } from '@tanstack/react-query';

// Làm mới theo lô: nhiều sự kiện real-time dồn dập (hoặc nhiều tab) chỉ gây MỘT lần tải lại mỗi key thay vì một lần mỗi
// sự kiện. Không "debounce kéo dài" (mỗi sự kiện đẩy lùi thời hạn): lần tải đầu luôn chạy sau tối đa `delayMs` kể từ sự
// kiện đầu tiên, và sự kiện đến SAU khi đã tải lại thì hẹn một lần tải mới — không sự kiện nào bị bỏ sót.
//
// Dùng chung cho mọi module có huy hiệu/danh sách được giữ tươi bằng sự kiện real-time (chat, thông báo): server là
// nguồn đúng của số chưa đọc nên sự kiện KHÔNG tự cộng +1 (đếm đôi nếu huy hiệu vừa được tải SAU khi sự kiện tới) mà
// chỉ hẹn một lần tải lại. Trạng thái hẹn giờ nằm theo từng QueryClient nên hai QueryClient (hai test, hai cây) không
// chạm nhau.
const INVALIDATE_DELAY_MS = 250;
const pendingInvalidations = new WeakMap<QueryClient, Map<string, ReturnType<typeof setTimeout>>>();

export function scheduleInvalidate(
  queryClient: QueryClient,
  queryKey: QueryKey,
  delayMs: number = INVALIDATE_DELAY_MS,
): void {
  let pending = pendingInvalidations.get(queryClient);
  if (!pending) {
    pending = new Map();
    pendingInvalidations.set(queryClient, pending);
  }
  const id = JSON.stringify(queryKey);
  if (pending.has(id)) return;
  const timers = pending;
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void queryClient.invalidateQueries({ queryKey });
    }, delayMs),
  );
}
