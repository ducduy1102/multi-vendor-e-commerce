import { useEffect, useState } from 'react';

// Trả về bản debounce của `value` — chỉ cập nhật sau khi `value` đứng yên
// trong `delayMs` (mỗi lần `value` đổi trước khi hết delay sẽ reset lại
// timer). Dùng để tránh gọi API/side-effect liên tục khi giá trị đổi nhanh
// (kéo slider, gõ phím liên tục...).
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
