// Giới hạn chống lạm dụng của chat (Week10.md 4.3/4.4). Hằng số cố định (chính sách bảo mật, không phải cấu hình
// triển khai) và LUÔN được áp bằng truy vấn DB thay vì bộ nhớ: bộ nhớ mất khi Render Free ngủ/khởi động lại (kẻ
// tấn công chỉ cần chờ) và sai khi chạy từ hai instance. Đây là giới hạn MỀM — hai request đồng thời cùng đọc
// "còn chỗ" có thể vượt vài đơn vị — chấp nhận được; phần theo IP/toàn cục là việc của throttler + Redis ở Tuần 12.

// Một người mua tối đa mở chừng này hội thoại MỚI trong cửa sổ trượt (chống mở hàng loạt để spam nhiều shop).
// Mở lại hội thoại đã có không tính. Cửa sổ: hội thoại tạo trong `WINDOW_MS` gần nhất (tạo đúng WINDOW_MS trước
// thì đã ra khỏi cửa sổ).
export const CHAT_NEW_CONVERSATIONS_LIMIT = 20;
export const CHAT_NEW_CONVERSATIONS_WINDOW_MS = 24 * 60 * 60 * 1000;
