// Type request/response của module chat, dùng chung qua @ecommerce/types (định nghĩa một lần ở packages/types).
import type { ChatMessage } from '@ecommerce/types';

export type {
  ChatCounterpart,
  ChatLastMessage,
  ChatMessage,
  ChatMessageEvent,
  ChatMessageFormInput,
  ChatReadPayload,
  ChatRole,
  ChatTypingPayload,
  ConversationList,
  ConversationSummary,
  MarkReadResult,
  MessageList,
  SendMessageInput,
  UnreadCount,
} from '@ecommerce/types';

// Phạm vi gọi API: một người dùng có thể vừa là NGƯỜI MUA vừa là CHỦ SHOP nên hai hộp thư tách bạch ở cả cache
// lẫn route (BE: `/conversations` cho người mua, `/shops/:shopId/conversations` cho chủ shop). Mọi hook/service
// của module nhận `ChatScope` thay vì tự đoán vai.
export type ChatScope = { role: 'BUYER' } | { role: 'SHOP'; shopId: string };

// Trạng thái giao của một tin do CHÍNH người dùng gửi và CHƯA được server xác nhận. Tin đã có trên server không
// mang trường này. `failed` giữ nguyên nội dung và `clientMessageId` để "thử lại" gửi ĐÚNG khoá cũ — server
// idempotent theo khoá đó nên không tạo bản sao dù lần gửi trước thật ra đã thành công mà phản hồi bị mất.
export type ChatDeliveryStatus = 'sending' | 'failed';

export interface ChatSendFailure {
  // Status HTTP; 0 = mất mạng / không có phản hồi (kết quả CHƯA RÕ — thử lại là an toàn nhờ idempotency).
  status: number;
  // Mã lỗi máy đọc được của BE (vd CHAT_SHOP_UNAVAILABLE, CHAT_RATE_LIMITED), nếu có.
  code?: string;
}

// Một dòng trong cache tin nhắn: tin từ server, hoặc tin tạm của chính người dùng (`id` bắt đầu bằng
// `pending:`). Nhờ đó giao diện chỉ cần một danh sách.
export interface ChatMessageItem extends ChatMessage {
  deliveryStatus?: ChatDeliveryStatus;
  failure?: ChatSendFailure;
}

// Một trang trong cache `useMessages`: tin MỚI NHẤT trước (đúng thứ tự BE trả), `nextCursor` trỏ về tin cũ hơn.
export interface ChatMessagesPage {
  items: ChatMessageItem[];
  nextCursor: string | null;
}
