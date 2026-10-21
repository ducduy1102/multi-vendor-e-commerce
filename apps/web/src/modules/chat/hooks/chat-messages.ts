import type { ChatDeliveryStatus, ChatMessage, ChatRole, ChatSendFailure } from '../types';
import type { OutboxItem } from '../store/chat-outbox.store';

// Một dòng trong danh sách tin hiển thị: tin đã có trên server, hoặc tin CỦA CHÍNH MÌNH đang gửi / gửi lỗi (lấy từ
// hộp chờ). Tin tạm có `id` bắt đầu bằng `pending:` để giao diện/khoá React không bao giờ nhầm với tin thật.
export interface ChatMessageView extends ChatMessage {
  deliveryStatus?: ChatDeliveryStatus;
  failure?: ChatSendFailure;
}

export const PENDING_ID_PREFIX = 'pending:';

export function isPendingMessage(message: { id: string }): boolean {
  return message.id.startsWith(PENDING_ID_PREFIX);
}

function toView(item: OutboxItem): ChatMessageView {
  return {
    id: `${PENDING_ID_PREFIX}${item.clientMessageId}`,
    conversationId: item.conversationId,
    senderRole: item.senderRole,
    content: item.content,
    createdAt: item.createdAt,
    clientMessageId: item.clientMessageId,
    deliveryStatus: item.deliveryStatus,
    ...(item.failure ? { failure: item.failure } : {}),
  };
}

// Mọi tin server đã nạp, MỚI NHẤT trước (ghép các trang theo thứ tự). Trùng `id` giữa các trang (trang tải sau chồng
// lên trang trước khi có tin mới chen vào) chỉ giữ một.
// Nhận kiểu cấu trúc tối thiểu (chỉ cần `pages[].items`) thay vì InfiniteData đầy đủ: tham số `pageParam` của query có thể
// bị suy ra là `unknown` ở nơi gọi, không liên quan tới việc ghép tin.
export function flattenServerMessages(
  data: { pages: readonly { items: readonly ChatMessage[] }[] } | undefined,
): ChatMessage[] {
  const seen = new Set<string>();
  const result: ChatMessage[] = [];
  for (const page of data?.pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}

// Danh sách hiển thị = tin chờ gửi (trên cùng — chúng luôn là mới nhất theo ý người gõ, bất kể đồng hồ máy) rồi tới
// tin server. Tin chờ gửi mà server ĐÃ có bản với cùng `clientMessageId` (đã giao nhưng hộp chờ chưa kịp dọn, hoặc
// làm mới tải về đúng tin đó) thì ẩn đi — không bao giờ hiện hai lần một tin.
export function mergeMessagesWithOutbox(
  serverMessages: readonly ChatMessage[],
  outbox: readonly OutboxItem[],
): ChatMessageView[] {
  const delivered = new Set(
    serverMessages.flatMap((message) => (message.clientMessageId ? [message.clientMessageId] : [])),
  );
  const pending = outbox.filter((item) => !delivered.has(item.clientMessageId)).map(toView);
  return [...pending, ...serverMessages];
}

// Mốc "đối phương đã đọc tới" mới hơn trong hai nguồn (bản tóm tắt từ API và sự kiện `chat:read`) — mốc chỉ tăng nên
// lấy cái lớn hơn. ISO 8601 cùng định dạng (`toISOString`) nên so chuỗi là so thời gian. null = chưa có nguồn nào.
export function latestReadMark(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a >= b ? a : b;
}

// Tin này của MÌNH đã được đối phương xem chưa (dấu "Đã xem"): tin do chính người xem gửi, đã lên server (không phải
// bản tạm đang gửi / gửi lỗi) và `createdAt` không muộn hơn mốc đối phương đã đọc tới. Tin của đối phương thì không
// bao giờ "được xem" theo nghĩa này.
export function isSeenByOther(
  message: { id: string; senderRole: ChatRole; createdAt: string },
  viewerRole: ChatRole,
  otherLastReadAt: string | null | undefined,
): boolean {
  if (!otherLastReadAt) return false;
  if (isPendingMessage(message) || message.senderRole !== viewerRole) return false;
  return message.createdAt <= otherLastReadAt;
}
