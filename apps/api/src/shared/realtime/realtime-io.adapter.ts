import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { IncomingMessage } from 'http';
import { RealtimeAccessService } from './realtime-access.service';

// Adapter Socket.io của ứng dụng (cài ở main.ts: `app.useWebSocketAdapter(new RealtimeIoAdapter(app))`). Việc
// duy nhất của nó là gắn `allowRequest` — chạy ở bước HTTP upgrade, TRƯỚC khi có kết nối WebSocket — để từ chối
// sớm Origin lạ và IP đang bị chặn bằng HTTP 403, rẻ hơn nhiều so với mở kết nối rồi mới đóng. Phải là adapter
// (không phải decorator của gateway) vì cần RealtimeAccessService lấy từ DI và danh sách Origin đọc lúc chạy.
// Hàng rào cuối cùng vẫn là middleware của RealtimeGateway, nên thiếu adapter này không làm mất an toàn.
//
// Các tuỳ chọn tĩnh (chỉ websocket, kích thước gói, timeout) nằm ở decorator của RealtimeGateway.
export class RealtimeIoAdapter extends IoAdapter {
  constructor(private readonly context: INestApplicationContext) {
    super(context);
  }

  createIOServer(port: number, options?: Record<string, unknown>): unknown {
    const access = this.context.get(RealtimeAccessService);
    return super.createIOServer(port, {
      ...options,
      allowRequest: (
        request: IncomingMessage,
        callback: (error: string | null | undefined, success: boolean) => void,
      ) => {
        const reason = access.checkUpgradeRequest(request);
        // Lý do đi trong thân phản hồi 403; không chứa dữ liệu nhạy cảm.
        if (reason) callback(reason, false);
        else callback(null, true);
      },
    });
  }
}
