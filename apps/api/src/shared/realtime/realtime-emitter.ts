import type { RealtimeEventName } from '@ecommerce/types';

// Cổng phát sự kiện real-time cho MỌI service nghiệp vụ (Week10.md 3.3, "Nguyên tắc để tách microservice sau"):
// service chỉ biết giao diện này, không biết Socket.io, phòng hay namespace. Khi tách cổng real-time thành
// service riêng, chỉ đổi bản cài đặt (vd phát qua Redis pub/sub) mà không sửa chỗ gọi.
//
// HỢP ĐỒNG: cả hai hàm là best-effort và KHÔNG BAO GIỜ reject — lỗi đẩy chỉ được log. Đây là side-effect chạy
// SAU KHI DB đã ghi xong (rules/backend.md mục 4); không có kết nối nào đang mở cũng không phải lỗi. Dù vậy
// nơi gọi vẫn nên bọc try/catch phòng một bản cài đặt khác vi phạm hợp đồng.
export interface RealtimeEmitter {
  // Gửi một sự kiện tới MỌI kết nối đang mở của một người dùng (nhiều tab/thiết bị). Người nhận luôn do nơi
  // gọi suy ra từ DB, không bao giờ lấy từ dữ liệu client gửi lên.
  emitToUser(
    userId: string,
    event: RealtimeEventName,
    payload?: unknown,
  ): Promise<void>;

  // Ngắt MỌI kết nối đang mở của một người dùng (đổi/đặt lại mật khẩu, đăng xuất; Tuần 11: Admin khoá tài
  // khoản). Chỉ ngắt các kết nối ĐANG mở — không ngăn nối lại bằng access token còn hạn; chặn nối lại là việc
  // của bước xác thực handshake (kiểm `accountStatus`).
  disconnectUser(userId: string): Promise<void>;
}

// Token DI của cổng phát sự kiện.
export const REALTIME_EMITTER = Symbol('REALTIME_EMITTER');
