import { useFormatter } from 'next-intl';

// Ngày + giờ hiển thị theo locale hiện tại (vi/en), cố định theo MÚI GIỜ TRÌNH DUYỆT — như useFormatAdminDate
// nhưng kèm giờ phút: khu hoàn tiền cần biết khoản hoàn/yêu cầu xảy ra lúc mấy giờ (hạn phản hồi, lần gọi cổng gần
// nhất). Chỉ dùng ở component render sau khi dữ liệu tải xong ở client nên không lệch hydration.
export function useFormatAdminDateTime(): (isoDate: string) => string {
  const format = useFormatter();

  return (isoDate) =>
    format.dateTime(new Date(isoDate), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
}
