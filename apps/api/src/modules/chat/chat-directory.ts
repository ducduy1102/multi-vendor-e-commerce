import type { ShopStatus } from '@prisma/client';

// Cổng "danh bạ" của chat (Week10.md 4.3, "Nguyên tắc để tách microservice sau"): mọi thứ chat cần biết về miền
// KHÁC (shop, người dùng) đi qua giao diện này, không đọc bảng của miền khác rải rác trong ChatService. Bản chạy
// trong cùng tiến trình đọc thẳng DB với `select` hẹp (prisma-chat-directory.ts); khi tách chat thành service
// riêng chỉ thay bản cài đặt (vd gọi HTTP sang API chính, hoặc đọc bản sao cập nhật bằng sự kiện).
export interface ChatShopInfo {
  id: string;
  ownerId: string;
  status: ShopStatus;
  name: string;
  logoUrl: string | null;
}

// Người dùng trong mắt đối phương: CHỈ id và tên hiển thị — không email, SĐT hay địa chỉ (Week10.md, checklist
// bảo mật dữ liệu chat). Cổng không có cách nào trả thêm, nên một nơi gọi mới không thể vô tình lộ chúng.
export interface ChatUserDisplay {
  id: string;
  name: string;
}

export interface ChatDirectory {
  // null nếu shop không tồn tại. Trạng thái trả nguyên để nơi gọi tự quyết (mở hội thoại chỉ với APPROVED, nhưng
  // hội thoại cũ của shop bị khoá vẫn đọc được ở chế độ chỉ đọc).
  getShopForChat(shopId: string): Promise<ChatShopInfo | null>;
  // Tra NHIỀU shop bằng một lượt (danh sách hội thoại của người mua — không N+1). Id không tồn tại bị bỏ qua,
  // thứ tự kết quả không đảm bảo.
  getShopsForChat(shopIds: string[]): Promise<ChatShopInfo[]>;
  // Tên hiển thị của nhiều người dùng bằng một lượt (danh sách hội thoại của shop: đối phương là người mua).
  getUserDisplay(userIds: string[]): Promise<ChatUserDisplay[]>;
}

// Token DI của cổng danh bạ.
export const CHAT_DIRECTORY = Symbol('CHAT_DIRECTORY');
