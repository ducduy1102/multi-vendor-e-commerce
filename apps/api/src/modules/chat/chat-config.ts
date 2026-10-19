// Giới hạn chống lạm dụng của chat (Week10.md 4.3/4.4). Hằng số cố định (chính sách bảo mật, không phải cấu hình
// triển khai) và LUÔN được áp bằng truy vấn DB thay vì bộ nhớ: bộ nhớ mất khi Render Free ngủ/khởi động lại (kẻ
// tấn công chỉ cần chờ) và sai khi chạy từ hai instance. Đây là giới hạn MỀM — hai request đồng thời cùng đọc
// "còn chỗ" có thể vượt vài đơn vị — chấp nhận được; phần theo IP/toàn cục là việc của throttler + Redis ở Tuần 12.

// Một người mua tối đa mở chừng này hội thoại MỚI trong cửa sổ trượt (chống mở hàng loạt để spam nhiều shop).
// Mở lại hội thoại đã có không tính. Cửa sổ: hội thoại tạo trong `WINDOW_MS` gần nhất (tạo đúng WINDOW_MS trước
// thì đã ra khỏi cửa sổ).
export const CHAT_NEW_CONVERSATIONS_LIMIT = 20;
export const CHAT_NEW_CONVERSATIONS_WINDOW_MS = 24 * 60 * 60 * 1000;

// Tốc độ gửi (Week10.md 4.4): tối đa chừng này tin của MỘT người gửi — tính trên mọi hội thoại của họ — trong cửa
// sổ ngắn. Vượt ⇒ 429 CHAT_RATE_LIMITED. Áp cho cả người mua lẫn chủ shop.
export const CHAT_SEND_RATE_LIMIT = 20;
export const CHAT_SEND_RATE_WINDOW_MS = 30 * 1000;

// Trần tin LIÊN TIẾP của người mua khi shop chưa trả lời (đếm tin của người mua sau tin cuối của shop trong
// hội thoại đó). Vượt ⇒ 429 CHAT_AWAITING_REPLY; tự mở lại ngay khi shop trả lời. Chỉ áp cho người mua — shop
// trả lời bao nhiêu tin cũng không bị trần này (chỉ bị giới hạn tốc độ ở trên).
export const CHAT_MAX_UNANSWERED_MESSAGES = 10;

// "Đang gõ" (Week10.md 4.7). Khác các giới hạn ở trên: đây là trạng thái TRONG BỘ NHỚ theo từng kết nối socket,
// có chủ ý — tín hiệu chỉ tồn tại vài giây, mất theo kết nối, không có gì để lách bằng cách chờ server khởi động
// lại (kết nối cũng mất theo) và không đáng một lượt truy vấn DB cho mỗi lần gõ.

// Tối đa 1 tín hiệu mỗi hội thoại mỗi socket trong khoảng này; sự kiện tới sớm hơn bị bỏ im lặng.
export const CHAT_TYPING_MIN_INTERVAL_MS = 2_000;

// Chặn lụt: một socket chỉ được xử lý chừng này sự kiện `chat:typing` (kể cả sự kiện sai định dạng) trong cửa sổ
// trượt, bất kể hội thoại nào. Người gõ thật gửi ~1 sự kiện/2 giây ⇒ chưa tới 5 trong cửa sổ; trần này chỉ để
// kẻ gửi bừa nhiều UUID không biến mỗi sự kiện thành một lượt kiểm thành viên ở DB.
export const CHAT_TYPING_FLOOD_MAX_EVENTS = 20;
export const CHAT_TYPING_FLOOD_WINDOW_MS = 10_000;

// Kết quả kiểm thành viên được nhớ theo socket để không truy vấn DB mỗi lần gõ. Người LÀ thành viên nhớ lâu hơn
// (quyền không đổi trong vài phút, và socket tự đóng khi access token hết hạn); người KHÔNG phải thành viên nhớ
// ngắn hơn để hội thoại mới tạo không bị từ chối quá lâu. Tối đa chừng này hội thoại được nhớ mỗi socket
// (đầy thì bỏ mục CŨ NHẤT) để kẻ gửi nhiều UUID không làm phình bộ nhớ.
export const CHAT_TYPING_MEMBER_TTL_MS = 5 * 60_000;
export const CHAT_TYPING_NON_MEMBER_TTL_MS = 30_000;
export const CHAT_TYPING_CACHE_MAX = 50;
