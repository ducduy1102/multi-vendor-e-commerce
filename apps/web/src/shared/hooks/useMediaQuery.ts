import { useSyncExternalStore } from 'react';

// Theo dõi một media query bằng `useSyncExternalStore` (không effect + setState): trả `false` ở server và lúc hydrate đầu rồi đồng bộ
// với trình duyệt, nên component client chỉ cần dựng KHÁC theo khổ màn hình khi thật sự phải (vd hàng đợi báo cáo: ở màn rộng bấm dòng là
// chọn để xem nhanh, ở màn hẹp là mở trang chi tiết). Việc chỉ đổi giao diện thì dùng breakpoint của Tailwind, không dùng hook này.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
