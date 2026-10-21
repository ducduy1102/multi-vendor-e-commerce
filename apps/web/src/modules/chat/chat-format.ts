import type { ChatMessageView } from './hooks/chat-messages';
import type { ChatRole, ChatSendFailure } from './types';

// Hàm THUẦN cho phần hiển thị chat (nhãn thời gian, huy hiệu, nhóm tin). Mọi hàm nhận "bây giờ" từ ngoài thay vì tự
// gọi `Date.now()` để test được và để component thuần không phụ thuộc đồng hồ khi render.

const MAX_BADGE = 99;
// Hai tin liên tiếp của cùng người cách nhau quá ngưỡng này thì tách thành nhóm mới (mỗi nhóm có một mốc giờ).
const RUN_GAP_MS = 5 * 60 * 1000;

// Số chưa đọc trên huy hiệu: ẩn khi 0, "99+" khi quá 99 (cùng quy ước huy hiệu giỏ hàng).
export function formatUnread(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > MAX_BADGE ? `${MAX_BADGE}+` : String(Math.floor(count));
}

// "Nguyễn Văn A" -> "NA" (chữ đầu của từ đầu + từ cuối, bỏ qua đệm giữa) — cách viết tắt tên tiếng Việt, cùng quy ước
// avatar ở Header. Tên một từ lấy hai chữ đầu; tên rỗng -> "?". Duyệt theo ký tự Unicode (không cắt đôi cặp
// surrogate của emoji).
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = (word: string) => Array.from(word)[0] ?? '';
  if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join('').toUpperCase();
  return (first(parts[0]) + first(parts[parts.length - 1])).toUpperCase();
}

// Khoá ngày theo GIỜ ĐỊA PHƯƠNG của trình duyệt (YYYY-MM-DD) — ranh giới "hôm nay/hôm qua" là của người dùng, không
// phải UTC.
export function localDayKey(value: Date | string | number): string {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// Số ngày lịch (giờ địa phương) từ `then` tới `now`: 0 = cùng ngày, 1 = hôm qua. Tính theo ngày lịch (không chia 24h)
// để đúng cả ngày chuyển giờ mùa hè (23/25 giờ).
function calendarDaysBetween(then: Date, now: Date): number {
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export type ListTimeLabel =
  | { kind: 'justNow' }
  | { kind: 'minutes'; count: number }
  | { kind: 'hours'; count: number }
  | { kind: 'yesterday' }
  | { kind: 'date'; date: Date };

// Nhãn thời gian ở danh sách hội thoại (giờ địa phương): dưới 1 phút "vừa xong", trong ngày "N phút"/"N giờ", hôm
// qua "Hôm qua", xa hơn là ngày tháng. Thời điểm ở TƯƠNG LAI (đồng hồ máy lệch) coi là "vừa xong", không hiện số âm.
export function classifyListTime(iso: string, now: number): ListTimeLabel {
  const then = new Date(iso);
  const current = new Date(now);
  const diffMs = now - then.getTime();
  if (diffMs < 60_000) return { kind: 'justNow' };

  const days = calendarDaysBetween(then, current);
  if (days <= 0) {
    const minutes = Math.floor(diffMs / 60_000);
    return minutes < 60
      ? { kind: 'minutes', count: minutes }
      : { kind: 'hours', count: Math.floor(minutes / 60) };
  }
  if (days === 1) return { kind: 'yesterday' };
  return { kind: 'date', date: then };
}

export type DayLabel = { kind: 'today' } | { kind: 'yesterday' } | { kind: 'date'; date: Date };

// Nhãn dải phân cách ngày trong khung tin: "Hôm nay", "Hôm qua", hoặc ngày đầy đủ.
export function classifyDay(iso: string, now: number): DayLabel {
  const then = new Date(iso);
  const days = calendarDaysBetween(then, new Date(now));
  if (days <= 0) return { kind: 'today' };
  if (days === 1) return { kind: 'yesterday' };
  return { kind: 'date', date: then };
}

// Một nhóm tin liên tiếp của cùng một người (cách nhau ≤ 5 phút), cũ → mới.
export interface MessageRun {
  senderRole: ChatRole;
  messages: ChatMessageView[];
}

// Một ngày (theo giờ địa phương) gồm các nhóm tin, cũ → mới.
export interface MessageDay {
  key: string;
  // Thời điểm tin đầu tiên của ngày, để dựng nhãn ngày.
  firstAt: string;
  runs: MessageRun[];
}

// Nhóm danh sách tin (MỚI NHẤT trước, đúng thứ tự `useMessages` trả) thành ngày → nhóm → tin để hiển thị CŨ → MỚI.
// Gom theo các tin LIÊN TIẾP cùng khoá ngày (không gom theo bảng tra): tin tạm ("đang gửi") luôn đứng cuối dù đồng hồ
// máy lệch, nên một tin tạm có ngày "sớm hơn" tin server không được kéo ngược một dải ngày cũ ra phía sau.
export function groupMessages(newestFirst: readonly ChatMessageView[]): MessageDay[] {
  const days: MessageDay[] = [];
  let previous: ChatMessageView | undefined;

  for (let index = newestFirst.length - 1; index >= 0; index--) {
    const message = newestFirst[index];
    const key = localDayKey(message.createdAt);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, firstAt: message.createdAt, runs: [] };
      days.push(day);
    }

    const lastRun = day.runs[day.runs.length - 1];
    const startsNewRun =
      !lastRun ||
      !previous ||
      previous.senderRole !== message.senderRole ||
      Math.abs(Date.parse(message.createdAt) - Date.parse(previous.createdAt)) > RUN_GAP_MS;
    if (startsNewRun) {
      day.runs.push({ senderRole: message.senderRole, messages: [message] });
    } else {
      lastRun.messages.push(message);
    }
    previous = message;
  }
  return days;
}

// Có nên cho nút "Thử lại" không. Mất mạng (status 0), lỗi máy chủ (5xx) và giới hạn tốc độ (429) có thể qua được ở
// lần sau; còn lại (400 nội dung sai, 403/404 không còn là thành viên, 409 shop ngừng nhận tin) là kết quả chắc
// chắn — thử lại cùng nội dung vô ích, chỉ cho "Xoá".
export function isRetryableFailure(failure: ChatSendFailure): boolean {
  return failure.status === 0 || failure.status >= 500 || failure.status === 429;
}
