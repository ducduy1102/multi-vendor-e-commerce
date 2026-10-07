import { useFormatter } from 'next-intl';

// Ngày giờ hiển thị của đơn hàng theo locale hiện tại (vi/en), cố định theo MÚI GIỜ TRÌNH DUYỆT —
// giống SellerVouchersContainer. Chỉ dùng ở component render sau khi dữ liệu tải xong ở client
// (không SSR dữ liệu đơn) nên không lệch hydration.
export function useFormatOrderDate(): (isoDate: string) => string {
  const format = useFormatter();

  return (isoDate) =>
    format.dateTime(new Date(isoDate), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
}
