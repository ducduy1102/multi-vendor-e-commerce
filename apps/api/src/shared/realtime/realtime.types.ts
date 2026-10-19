import type { IncomingHttpHeaders } from 'http';
import type { VerifiedSocketToken } from './socket-authenticator';

// Dữ liệu gắn vào mỗi socket sau khi xác thực (socket.data).
export interface RealtimeSocketData {
  user: VerifiedSocketToken;
  // Thời điểm kết nối (ms) — để biết kết nối nào CŨ NHẤT khi vượt trần số kết nối mỗi người dùng.
  connectedAt: number;
}

// Phần của socket.io Socket/Server mà hạ tầng này dùng, khai bằng interface cấu trúc thay vì import kiểu từ
// 'socket.io': gói đó chỉ là phụ thuộc gián tiếp của @nestjs/platform-socket.io nên pnpm không cho `apps/api`
// import trực tiếp, và không thêm dependency ngoài 3 gói đã duyệt (Week10.md D1). Đổi lại, các lớp ở đây thử
// được bằng socket giả có kiểu. Khớp thật với socket.io được kiểm bằng kết nối thật (e2e, 3.4).
export interface RealtimeSocket {
  readonly id: string;
  readonly handshake: {
    readonly headers: IncomingHttpHeaders;
    readonly address: string;
  };
  data: Partial<RealtimeSocketData>;
  join(room: string): void | Promise<void>;
  emit(event: string, ...args: unknown[]): unknown;
  disconnect(close?: boolean): unknown;
}

// Socket nhìn từ xa (kết quả của `fetchSockets()`): đủ để đọc dữ liệu và ngắt, kể cả khi sau này có adapter
// nhiều instance.
export interface RealtimeSocketHandle {
  readonly id: string;
  readonly data: Partial<RealtimeSocketData>;
  disconnect(close?: boolean): unknown;
}

export type RealtimeMiddleware = (
  socket: RealtimeSocket,
  next: (error?: Error) => void,
) => void;

export interface RealtimeServer {
  use(middleware: RealtimeMiddleware): unknown;
  in(room: string): { fetchSockets(): Promise<RealtimeSocketHandle[]> };
}
