// Giới hạn chống lạm dụng khi gửi báo cáo (Week11.md 5.3, D5). Đếm bằng truy vấn DB, không giữ trạng thái trong bộ nhớ nên đúng cả
// sau khi khởi động lại và với nhiều instance.

// Một người gửi tối đa chừng này báo cáo trong cửa sổ trượt bên dưới — tính MỌI báo cáo của người đó (đang mở hay đã đóng), nên
// người bị Admin bỏ qua hàng loạt cũng không báo lại liên tục được. Vượt ⇒ 429 REPORT_LIMIT_REACHED.
export const REPORT_DAILY_LIMIT = 10;
export const REPORT_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
