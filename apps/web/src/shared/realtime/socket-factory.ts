import type { RealtimeClientSocket, SocketFactory } from './realtime-client';

// Nhà máy socket mặc định. `import()` ĐỘNG là chủ đích (Week10.md 3.5): `socket.io-client` (~40 KB gzip) tách
// thành chunk riêng, chỉ tải khi RealtimeProvider thật sự gọi tới — tức là chỉ khi đã đăng nhập. Khách vãng lai
// không tải thêm byte nào, giữ nguyên điểm Lighthouse của trang chủ và trang sản phẩm.
export const defaultSocketFactory: SocketFactory = async (url, options) => {
  const { io } = await import('socket.io-client');
  // `Socket` thật có kiểu sự kiện chặt hơn interface cấu trúc của bộ điều khiển; ép kiểu ở đúng một chỗ này.
  return io(url, options) as unknown as RealtimeClientSocket;
};
