import { useFormatter } from 'next-intl';

// Định dạng giờ/ngày của chat theo locale hiện tại (vi/en), cố định theo MÚI GIỜ TRÌNH DUYỆT — cùng ranh giới ngày với
// `chat-format.ts` (hôm nay/hôm qua tính theo giờ địa phương) và cùng cách `useFormatOrderDate` làm (next-intl cảnh
// báo thiếu `timeZone` nếu không truyền). Chỉ dùng ở component render sau khi dữ liệu tải xong ở client nên không lệch
// hydration.
export function useChatDateFormat() {
  const format = useFormatter();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return {
    // Giờ gửi của một tin: "09:05".
    time: (iso: string) =>
      format.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit', timeZone }),
    // Ngày ngắn ở danh sách hội thoại: "07/01".
    shortDate: (date: Date) =>
      format.dateTime(date, { day: '2-digit', month: '2-digit', timeZone }),
    // Dải ngày trong khung tin: "T2, 07/01/2030".
    fullDate: (date: Date) =>
      format.dateTime(date, {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone,
      }),
  };
}
