import { useFormatter } from 'next-intl';

// "3 ngày trước", "5 giờ trước" so với `now` (lấy từ `useNow`, không gọi `Date.now()` lúc render). next-intl tự chọn đơn vị lớn nhất hợp
// lý theo khoảng cách.
export function useFormatAdminRelativeTime(): (isoDate: string, now: number) => string {
  const format = useFormatter();

  return (isoDate, now) => format.relativeTime(new Date(isoDate), now);
}
