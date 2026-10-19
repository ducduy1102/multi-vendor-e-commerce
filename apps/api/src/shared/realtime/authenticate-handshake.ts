import type { RealtimeConnectError } from '@ecommerce/types';
import { ACCESS_TOKEN_COOKIE } from '../utils/session-cookie-names';
import { parseCookieHeader } from './parse-cookie-header';
import type {
  SocketAuthenticator,
  VerifiedSocketToken,
} from './socket-authenticator';

export type HandshakeRejectReason = Extract<
  RealtimeConnectError,
  'MISSING_TOKEN' | 'INVALID_TOKEN' | 'ACCOUNT_NOT_ACTIVE'
>;

export type HandshakeAuthResult =
  | { ok: true; user: VerifiedSocketToken }
  | { ok: false; reason: HandshakeRejectReason };

// Xác thực một handshake WebSocket bằng cookie httpOnly `access_token` — cùng cơ chế với REST (JwtStrategy),
// KHÔNG nhận token qua query string/auth payload (sẽ lọt vào log truy cập và lịch sử trình duyệt).
//
// Chỉ trả kết quả xác thực (có/không + lý do). Lỗi HẠ TẦNG của cổng xác thực (DB sập, thiếu secret) được ném
// tiếp lên cho nơi gọi, vì "không xác thực được" khác "token sai" — nơi gọi từ chối kết nối (đóng) nhưng
// không đếm đó là lỗi của client.
export async function authenticateHandshake(
  headers: { cookie?: string },
  authenticator: SocketAuthenticator,
): Promise<HandshakeAuthResult> {
  const token = parseCookieHeader(headers.cookie).get(ACCESS_TOKEN_COOKIE);
  if (!token) return { ok: false, reason: 'MISSING_TOKEN' };

  const verified = await authenticator.verifyToken(token);
  if (!verified) return { ok: false, reason: 'INVALID_TOKEN' };

  if (!(await authenticator.isUserActive(verified.userId))) {
    return { ok: false, reason: 'ACCOUNT_NOT_ACTIVE' };
  }
  return { ok: true, user: verified };
}
