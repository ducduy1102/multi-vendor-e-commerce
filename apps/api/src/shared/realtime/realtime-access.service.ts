import { Injectable, Logger } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'http';
import { parseTrustProxy } from '../utils/parse-trust-proxy';
import { readCorsOrigins } from '../utils/read-cors-origins';
import {
  createFailedHandshakeLimiter,
  type FailedHandshakeLimiter,
} from './failed-handshake-limiter';
import { resolveClientIp } from './resolve-client-ip';

// Cổng kiểm tra ĐẦU VÀO của kết nối real-time, trước cả việc đọc token: Origin có được phép không và IP này
// có đang bị chặn vì thất bại liên tục không. Gom vào một provider để hai nơi dùng chung MỘT bộ đếm — adapter
// (từ chối sớm ngay ở HTTP upgrade, rẻ nhất) và middleware của gateway (nơi quyết định cuối cùng).
@Injectable()
export class RealtimeAccessService {
  private readonly logger = new Logger(RealtimeAccessService.name);
  // Trạng thái trong bộ nhớ: xem chú thích ở failed-handshake-limiter.ts (Redis ở Tuần 12).
  private readonly limiter: FailedHandshakeLimiter =
    createFailedHandshakeLimiter();

  // Chống Cross-Site WebSocket Hijacking: trình duyệt luôn gửi `Origin` thật cho kết nối WebSocket và trang
  // lạ không giả được nó, nên đây là hàng rào phía server. So khớp CHÍNH XÁC với CORS_ORIGIN (cùng danh sách
  // với REST). Thiếu Origin ⇒ từ chối: kẻ tấn công cần cookie của nạn nhân thì phải chạy trong trình duyệt,
  // mà trình duyệt thì luôn gửi Origin. Danh sách đọc LÚC DÙNG (rules/backend.md mục 8).
  isOriginAllowed(origin: string | undefined): boolean {
    return !!origin && readCorsOrigins().includes(origin);
  }

  clientIp(
    headers: IncomingHttpHeaders,
    remoteAddress: string | undefined,
  ): string {
    const forwarded = headers['x-forwarded-for'];
    return resolveClientIp(
      Array.isArray(forwarded) ? forwarded.join(',') : forwarded,
      remoteAddress,
      parseTrustProxy(process.env.TRUST_PROXY),
    );
  }

  isBlocked(ip: string): boolean {
    return this.limiter.isBlocked(ip);
  }

  recordFailure(ip: string): void {
    if (this.limiter.recordFailure(ip)) {
      this.logger.warn(
        `Realtime handshakes from ${ip} blocked after repeated failures`,
      );
    }
  }

  // Dùng ở `allowRequest` của engine.io (trước khi nâng cấp lên WebSocket). Trả null nếu cho qua, hoặc lý do
  // từ chối. Không đọc/ghi log header Cookie hay token ở đây.
  checkUpgradeRequest(request: {
    headers: IncomingHttpHeaders;
    socket?: { remoteAddress?: string };
  }): 'TOO_MANY_ATTEMPTS' | 'FORBIDDEN_ORIGIN' | null {
    const ip = this.clientIp(request.headers, request.socket?.remoteAddress);
    if (this.isBlocked(ip)) return 'TOO_MANY_ATTEMPTS';
    if (!this.isOriginAllowed(request.headers.origin)) {
      this.recordFailure(ip);
      return 'FORBIDDEN_ORIGIN';
    }
    return null;
  }
}
