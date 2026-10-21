import { z } from 'zod';

const conversationIdSchema = z.string().uuid();

// `?c=<id>` của trang hộp thư (`/chat`, `/seller/chat`): hội thoại đang chọn. Query là dữ liệu tuỳ ý từ URL nên chỉ nhận
// UUID hợp lệ — giá trị sai/thiếu/lặp nhiều lần rơi về "chưa chọn" (trang vẫn hiện danh sách), không làm sập trang và
// không bao giờ đi vào URL gọi API (id hội thoại còn được `encodeURIComponent` ở service và BE kiểm lại thành viên).
// Lặp `?c=a&c=b` lấy giá trị đầu, cùng cách các trang khác đọc query.
export function parseChatPageQuery(raw: Record<string, string | string[] | undefined>): {
  conversationId: string | null;
} {
  const value = Array.isArray(raw.c) ? raw.c[0] : raw.c;
  const parsed = conversationIdSchema.safeParse(value);
  return { conversationId: parsed.success ? parsed.data : null };
}
