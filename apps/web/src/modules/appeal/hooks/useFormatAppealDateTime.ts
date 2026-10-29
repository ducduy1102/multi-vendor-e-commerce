import { useFormatter } from 'next-intl';

// Ngày + giờ hiển thị theo locale hiện tại (vi/en), cố định theo MÚI GIỜ TRÌNH DUYỆT (next-intl cảnh báo ENVIRONMENT_FALLBACK nếu
// thiếu `timeZone`). Chỉ dùng ở component render sau khi dữ liệu tải xong ở client nên không lệch hydration.
export function useFormatAppealDateTime(): (isoDate: string) => string {
  const format = useFormatter();

  return (isoDate) =>
    format.dateTime(new Date(isoDate), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
}
