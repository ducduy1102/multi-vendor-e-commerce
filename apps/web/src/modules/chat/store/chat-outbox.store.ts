import { create } from 'zustand';

import { registerSessionReset } from '@/shared/lib/session-reset';

import type { ChatDeliveryStatus, ChatRole, ChatSendFailure } from '../types';

// "Hộp chờ gửi" (outbox): các tin CỦA CHÍNH NGƯỜI DÙNG đã bấm gửi nhưng CHƯA được server xác nhận — đang gửi hoặc
// gửi lỗi. Cố ý KHÔNG nằm trong cache TanStack Query của tin nhắn: mỗi lần làm mới (nối lại real-time, focus lại
// cửa sổ) cache được thay bằng dữ liệu server và tin "gửi lỗi" — thứ server chưa hề có — sẽ biến mất khỏi màn hình
// cùng nội dung người dùng đã gõ. Đây là dữ liệu do client tạo (không phải server state) và chia sẻ giữa các
// component/route nên theo `rules/frontend.md` mục 3 thuộc Zustand.
//
// Chỉ ở trong bộ nhớ của tab (mất khi tải lại trang). Khi tin được xác nhận (HTTP trả về hoặc sự kiện real-time
// mang đúng `clientMessageId`) thì `remove`.
export interface OutboxItem {
  clientMessageId: string;
  conversationId: string;
  senderRole: ChatRole;
  content: string;
  // Giờ của CLIENT lúc bấm gửi — chỉ để hiển thị tạm, tin thật lấy giờ của server.
  createdAt: string;
  deliveryStatus: ChatDeliveryStatus;
  failure?: ChatSendFailure;
}

interface ChatOutboxState {
  // Theo hội thoại; trong mỗi hội thoại: MỚI NHẤT trước (khớp thứ tự của danh sách tin).
  byConversation: Record<string, OutboxItem[]>;
  enqueue: (item: Omit<OutboxItem, 'deliveryStatus' | 'failure'>) => void;
  markSending: (conversationId: string, clientMessageId: string) => void;
  markFailed: (conversationId: string, clientMessageId: string, failure: ChatSendFailure) => void;
  remove: (conversationId: string, clientMessageId: string) => void;
  clear: () => void;
}

function updateItem(
  state: Record<string, OutboxItem[]>,
  conversationId: string,
  clientMessageId: string,
  change: (item: OutboxItem) => OutboxItem,
): Record<string, OutboxItem[]> {
  const items = state[conversationId];
  if (!items?.some((item) => item.clientMessageId === clientMessageId)) return state;
  return {
    ...state,
    [conversationId]: items.map((item) =>
      item.clientMessageId === clientMessageId ? change(item) : item,
    ),
  };
}

export const useChatOutboxStore = create<ChatOutboxState>((set) => ({
  byConversation: {},
  enqueue: (item) =>
    set((state) => {
      const existing = state.byConversation[item.conversationId] ?? [];
      // Cùng clientMessageId đã có (gọi lặp) ⇒ không nhân đôi.
      if (existing.some((entry) => entry.clientMessageId === item.clientMessageId)) return state;
      return {
        byConversation: {
          ...state.byConversation,
          [item.conversationId]: [{ ...item, deliveryStatus: 'sending' }, ...existing],
        },
      };
    }),
  markSending: (conversationId, clientMessageId) =>
    set((state) => ({
      byConversation: updateItem(state.byConversation, conversationId, clientMessageId, (item) => {
        const next: OutboxItem = { ...item, deliveryStatus: 'sending' };
        delete next.failure;
        return next;
      }),
    })),
  markFailed: (conversationId, clientMessageId, failure) =>
    set((state) => ({
      byConversation: updateItem(state.byConversation, conversationId, clientMessageId, (item) => ({
        ...item,
        deliveryStatus: 'failed',
        failure,
      })),
    })),
  remove: (conversationId, clientMessageId) =>
    set((state) => {
      const items = state.byConversation[conversationId];
      if (!items?.some((item) => item.clientMessageId === clientMessageId)) return state;
      const remaining = items.filter((item) => item.clientMessageId !== clientMessageId);
      const others = Object.entries(state.byConversation).filter(([id]) => id !== conversationId);
      return {
        byConversation: Object.fromEntries(
          remaining.length > 0 ? [...others, [conversationId, remaining]] : others,
        ),
      };
    }),
  clear: () => set({ byConversation: {} }),
}));

// Xoá sạch hộp chờ — gọi khi người dùng đăng xuất/đổi tài khoản để nội dung chưa gửi của người trước không nằm lại
// trong bộ nhớ của tab. Module chat không biết đăng xuất (không import auth) nên TỰ ĐĂNG KÝ hàm này vào sổ dọn phiên
// bên dưới; `SessionCacheReset` (layout) gọi sổ đó khi đổi người/đăng xuất.
export function resetChatOutbox(): void {
  useChatOutboxStore.getState().clear();
}

// Đăng ký NGAY khi tệp này được nạp (tức là ngay khi bất kỳ mã chat nào dùng hộp chờ được nạp): có hộp chờ ⇒ chắc chắn
// đã đăng ký, không phụ thuộc component nạp động nào mount kịp hay không. Xem shared/lib/session-reset.ts.
registerSessionReset(resetChatOutbox);

// Danh sách rỗng DÙNG CHUNG một identity để selector `useChatOutboxStore((s) => s.byConversation[id] ?? EMPTY)`
// không tạo mảng mới mỗi lần (Zustand so sánh bằng ===, mảng mới = render lại vô hạn).
export const EMPTY_OUTBOX: readonly OutboxItem[] = Object.freeze([]);
