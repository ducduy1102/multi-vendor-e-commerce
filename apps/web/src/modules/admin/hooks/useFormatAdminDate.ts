import { useFormatter } from 'next-intl';

// Ngày tạo shop hiển thị theo locale hiện tại (vi/en), cố định theo MÚI GIỜ TRÌNH DUYỆT — giống
// useFormatOrderDate. Chỉ dùng ở component render sau khi dữ liệu tải xong ở client nên không lệch
// hydration.
export function useFormatAdminDate(): (isoDate: string) => string {
  const format = useFormatter();

  return (isoDate) =>
    format.dateTime(new Date(isoDate), {
      dateStyle: 'medium',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
}
