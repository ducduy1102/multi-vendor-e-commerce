import { useEffect, useState } from 'react';

// "Bây giờ" (ms) để dựng nhãn thời gian tương đối ("5 phút", "Hôm qua"). Chốt một lần lúc mount rồi cập nhật mỗi
// `intervalMs` — `Date.now()` là hàm không thuần nên không gọi thẳng lúc render. Một phút là đủ mịn cho nhãn nhỏ nhất
// ("N phút"); cập nhật trong callback của timer (không phải đồng bộ trong effect).
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
