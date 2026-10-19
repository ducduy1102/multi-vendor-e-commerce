import {
  CHAT_TYPING_CACHE_MAX,
  CHAT_TYPING_FLOOD_MAX_EVENTS,
  CHAT_TYPING_FLOOD_WINDOW_MS,
  CHAT_TYPING_MEMBER_TTL_MS,
  CHAT_TYPING_MIN_INTERVAL_MS,
  CHAT_TYPING_NON_MEMBER_TTL_MS,
} from './chat-config';

// Trạng thái "đang gõ" của MỘT kết nối socket (Week10.md 4.7). Thuần logic, không biết gì về socket.io hay DB: chỉ
// đồng hồ, nên thử được bằng đồng hồ giả. ChatGateway giữ một bản cho mỗi socket (WeakMap) nên trạng thái tự biến
// mất cùng kết nối. Mọi cấu trúc ở đây đều CÓ TRẦN kích thước, vì dữ liệu vào là UUID do client tự chọn.
//
// Thứ tự dùng (ChatGateway): withinFloodLimit → (parse) → claimSlot → recall/remember.
export class SocketTypingState {
  private readonly eventTimes: number[] = [];
  private readonly lastClaimedAt = new Map<string, number>();
  private readonly membership = new Map<
    string,
    { recipientId: string | null; expiresAt: number }
  >();

  constructor(private readonly clock: () => number = () => Date.now()) {}

  // Chặn lụt: tối đa CHAT_TYPING_FLOOD_MAX_EVENTS sự kiện được xử lý trong cửa sổ trượt, bất kể hội thoại. Sự kiện bị
  // từ chối KHÔNG được ghi lại, nên kẻ gửi bừa không tự kéo dài thời gian bị chặn của chính mình mãi mãi.
  withinFloodLimit(): boolean {
    const now = this.clock();
    while (
      this.eventTimes.length > 0 &&
      now - this.eventTimes[0] >= CHAT_TYPING_FLOOD_WINDOW_MS
    ) {
      this.eventTimes.shift();
    }
    if (this.eventTimes.length >= CHAT_TYPING_FLOOD_MAX_EVENTS) return false;
    this.eventTimes.push(now);
    return true;
  }

  // Tối đa 1 tín hiệu mỗi hội thoại trong CHAT_TYPING_MIN_INTERVAL_MS. "Giành chỗ" NGAY khi được nhận (trước khi
  // hỏi DB) để hai sự kiện tới sát nhau không cùng lọt qua trong lúc chờ kết quả kiểm thành viên.
  claimSlot(conversationId: string): boolean {
    const now = this.clock();
    const last = this.lastClaimedAt.get(conversationId);
    if (last !== undefined && now - last < CHAT_TYPING_MIN_INTERVAL_MS) {
      return false;
    }
    this.lastClaimedAt.delete(conversationId);
    this.lastClaimedAt.set(conversationId, now);
    this.trim(this.lastClaimedAt);
    return true;
  }

  // undefined = chưa biết (phải hỏi); { recipientId: null } = đã biết KHÔNG phải thành viên; ngược lại là người
  // nhận (đối phương). Mục hết hạn bị xoá và coi như chưa biết.
  recall(conversationId: string): { recipientId: string | null } | undefined {
    const entry = this.membership.get(conversationId);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock()) {
      this.membership.delete(conversationId);
      return undefined;
    }
    return { recipientId: entry.recipientId };
  }

  remember(conversationId: string, recipientId: string | null): void {
    const ttl =
      recipientId === null
        ? CHAT_TYPING_NON_MEMBER_TTL_MS
        : CHAT_TYPING_MEMBER_TTL_MS;
    this.membership.delete(conversationId);
    this.membership.set(conversationId, {
      recipientId,
      expiresAt: this.clock() + ttl,
    });
    this.trim(this.membership);
  }

  // Map giữ thứ tự chèn nên phần tử đầu là CŨ NHẤT.
  private trim(map: Map<string, unknown>): void {
    while (map.size > CHAT_TYPING_CACHE_MAX) {
      const oldest = map.keys().next();
      if (oldest.done) return;
      map.delete(oldest.value);
    }
  }
}
