import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { REALTIME_EVENTS, type RealtimeEventName } from '@ecommerce/types';
import {
  authenticateHandshake,
  type HandshakeAuthResult,
} from './authenticate-handshake';
import { RealtimeAccessService } from './realtime-access.service';
import type { RealtimeEmitter } from './realtime-emitter';
import {
  REALTIME_CONNECT_TIMEOUT_MS,
  REALTIME_MAX_HTTP_BUFFER_BYTES,
  REALTIME_MAX_SOCKETS_PER_USER,
  userRoom,
} from './realtime.constants';
import type { RealtimeServer, RealtimeSocket } from './realtime.types';
import {
  SOCKET_AUTHENTICATOR,
  type SocketAuthenticator,
} from './socket-authenticator';

// setTimeout lưu độ trễ trong số nguyên 32-bit có dấu: lớn hơn ~24,8 ngày sẽ bị kẹp xuống 1ms.
const MAX_TIMER_MS = 2 ** 31 - 1;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Hạ tầng real-time (Week10.md 3.2) — CHỈ lo kết nối: xác thực, phòng riêng của từng người dùng, giới hạn kết
// nối và ngắt khi token hết hạn. KHÔNG chứa nghiệp vụ chat/thông báo, và cố ý KHÔNG có `@SubscribeMessage`
// nào: client không có sự kiện nào để gửi lên (kể cả để tự vào phòng) nên bề mặt tấn công chỉ là bước kết nối.
// Mọi sự kiện lạ client gửi lên đều bị socket.io bỏ qua. Lệnh ghi đi qua REST (D2); sự kiện `chat:typing` sẽ
// được thêm ở module chat, không ở đây.
//
// Các tuỳ chọn tĩnh khai ở decorator (có hiệu lực dù adapter tuỳ biến có được cài hay không):
//   - chỉ `websocket` (không long-polling): ít bề mặt hơn và không cần sticky session;
//   - gói tối đa ~1 KB, `connectTimeout` ngắn, không phục vụ file client của socket.io.
// Không đặt `cors`: với chỉ WebSocket, trình duyệt không áp CORS (không có XHR); hàng rào chống CSWSH là kiểm
// `Origin` ở RealtimeAccessService. Đường dẫn mặc định `/socket.io` ở gốc host, KHÔNG nằm dưới global prefix
// `api/v1` của REST.
@WebSocketGateway({
  transports: ['websocket'],
  maxHttpBufferSize: REALTIME_MAX_HTTP_BUFFER_BYTES,
  connectTimeout: REALTIME_CONNECT_TIMEOUT_MS,
  serveClient: false,
})
export class RealtimeGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy,
    RealtimeEmitter
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  @WebSocketServer()
  private server!: RealtimeServer;

  // Constructor rẻ và không throw (rules/backend.md mục 8): không đọc ENV, không kết nối gì ở đây.
  constructor(
    private readonly access: RealtimeAccessService,
    @Inject(SOCKET_AUTHENTICATOR)
    private readonly authenticator: SocketAuthenticator,
  ) {}

  afterInit(server: RealtimeServer): void {
    // Middleware chạy cho MỌI kết nối trước sự kiện `connection`: từ chối ở đây thì client nhận `connect_error`
    // với `message` là lý do (REALTIME_CONNECT_ERRORS) và socket không bao giờ vào phòng nào.
    server.use((socket, next) => {
      void this.admit(socket).then((error) => next(error));
    });
  }

  async handleConnection(client: RealtimeSocket): Promise<void> {
    const user = client.data.user;
    if (!user) {
      // Không thể xảy ra khi middleware đã chạy; đóng thay vì để một socket chưa xác thực vào hệ thống.
      client.disconnect(true);
      return;
    }

    // Hẹn giờ NGAY (đồng bộ) trước mọi `await`, để handleDisconnect luôn thấy và xoá được nó.
    this.scheduleExpiry(client, user.exp * 1000);
    try {
      await client.join(userRoom(user.userId));
      await this.evictOldestSockets(user.userId);
    } catch (error) {
      this.logger.error(
        `Realtime connection setup failed for user ${user.userId}: ${errorMessage(error)}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: RealtimeSocket): void {
    this.clearExpiry(client.id);
  }

  // --- RealtimeEmitter (cổng cho các service nghiệp vụ, được cấp qua token REALTIME_EMITTER) ---
  // Best-effort theo đúng hợp đồng của giao diện: không bao giờ reject. `server` chỉ được Nest gán khi ứng
  // dụng HTTP đã khởi tạo (Nest bỏ qua gateway ở ngữ cảnh không có HTTP như nhiều integration test, hay trước
  // `app.init()`) — lúc đó không có ai để gửi tới, không phải lỗi.
  emitToUser(
    userId: string,
    event: RealtimeEventName,
    payload?: unknown,
  ): Promise<void> {
    // Phát với adapter trong bộ nhớ là đồng bộ; giao diện trả Promise để bản cài đặt từ xa sau này dùng được.
    if (!this.server) return Promise.resolve();
    try {
      const room = this.server.to(userRoom(userId));
      // Không gửi tham số thừa khi sự kiện không có payload (vd auth:expired).
      if (payload === undefined) room.emit(event);
      else room.emit(event, payload);
    } catch (error) {
      // Chỉ log tên sự kiện và id — không bao giờ log payload (có thể chứa dữ liệu của người dùng).
      this.logger.error(
        `Realtime emit "${event}" failed for user ${userId}: ${errorMessage(error)}`,
      );
    }
    return Promise.resolve();
  }

  async disconnectUser(userId: string): Promise<void> {
    if (!this.server) return;
    try {
      await this.server.in(userRoom(userId)).disconnectSockets(true);
    } catch (error) {
      this.logger.error(
        `Realtime disconnect failed for user ${userId}: ${errorMessage(error)}`,
      );
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.expiryTimers.values()) clearTimeout(timer);
    this.expiryTimers.clear();
  }

  // Quyết định cho một kết nối mới. Trả lỗi để từ chối, undefined để cho qua. Origin được kiểm LẠI ở đây dù
  // adapter đã kiểm lúc upgrade: nếu adapter tuỳ biến không được cài thì hàng rào chính vẫn còn.
  private async admit(socket: RealtimeSocket): Promise<Error | undefined> {
    const { headers, address } = socket.handshake;
    const ip = this.access.clientIp(headers, address);

    if (this.access.isBlocked(ip)) return new Error('TOO_MANY_ATTEMPTS');
    if (!this.access.isOriginAllowed(headers.origin)) {
      this.access.recordFailure(ip);
      return new Error('FORBIDDEN_ORIGIN');
    }

    let result: HandshakeAuthResult;
    try {
      result = await authenticateHandshake(headers, this.authenticator);
    } catch (error) {
      // Lỗi hạ tầng (DB sập, thiếu secret): đóng, không đếm vào IP — lỗi của server chứ không phải của client.
      // Chỉ log thông điệp lỗi, không bao giờ log header/cookie/token.
      this.logger.error(
        `Realtime authentication unavailable: ${errorMessage(error)}`,
      );
      return new Error('AUTH_UNAVAILABLE');
    }

    if (!result.ok) {
      this.access.recordFailure(ip);
      return new Error(result.reason);
    }

    socket.data.user = result.user;
    socket.data.connectedAt = Date.now();
    return undefined;
  }

  // Ngắt kết nối đúng lúc access token hết hạn: phát `auth:expired` rồi đóng. Client phải gia hạn phiên rồi nối
  // lại bằng cookie mới. Đóng cứng (`disconnect(true)`) vì đây là ranh giới bảo mật: client bỏ qua sự kiện
  // cũng không giữ được kết nối. Đã kiểm với socket.io-client thật: client nhận `auth:expired` rồi thấy lý do
  // ngắt "io server disconnect" — theo thiết kế của socket.io, lý do này KHÔNG tự nối lại, nên client phải tự
  // gia hạn phiên rồi gọi connect() (kết nối mới đọc cookie mới).
  private scheduleExpiry(client: RealtimeSocket, expiresAtMs: number): void {
    const arm = () => {
      const remaining = Math.max(0, expiresAtMs - Date.now());
      const timer = setTimeout(
        () => {
          // Độ trễ bị kẹp ở MAX_TIMER_MS thì chưa tới hạn thật: hẹn tiếp.
          if (expiresAtMs - Date.now() > 0) {
            arm();
            return;
          }
          this.expiryTimers.delete(client.id);
          client.emit(REALTIME_EVENTS.authExpired);
          client.disconnect(true);
        },
        Math.min(remaining, MAX_TIMER_MS),
      );
      // Hẹn giờ này không được giữ tiến trình sống khi tắt server.
      timer.unref();
      this.expiryTimers.set(client.id, timer);
    };
    arm();
  }

  private clearExpiry(socketId: string): void {
    const timer = this.expiryTimers.get(socketId);
    if (!timer) return;
    clearTimeout(timer);
    this.expiryTimers.delete(socketId);
  }

  // Giữ tối đa REALTIME_MAX_SOCKETS_PER_USER kết nối mỗi người dùng bằng cách ngắt các kết nối CŨ NHẤT (lý do
  // ở realtime.constants.ts). Đếm theo thành viên phòng thay vì bộ đếm riêng: không thể rò rỉ khi một kết nối
  // đứt giữa chừng, và đúng cả khi sau này có adapter nhiều instance. Đua giữa hai kết nối cùng lúc chỉ có thể
  // làm vượt trần thoáng qua (lần kết nối kế tiếp sẽ dọn lại) — đây là giới hạn mềm.
  // Client bị ngắt thấy "io server disconnect" nên KHÔNG tự nối lại (đã kiểm với socket.io-client thật) — các tab
  // không đá nhau vô tận khi người dùng mở quá trần. `disconnect(false)` chỉ rời namespace, không đóng cả
  // đường truyền.
  private async evictOldestSockets(userId: string): Promise<void> {
    const sockets = await this.server.in(userRoom(userId)).fetchSockets();
    const excess = sockets.length - REALTIME_MAX_SOCKETS_PER_USER;
    if (excess <= 0) return;

    sockets
      .sort((a, b) => (a.data.connectedAt ?? 0) - (b.data.connectedAt ?? 0))
      .slice(0, excess)
      .forEach((socket) => socket.disconnect(false));
  }
}
