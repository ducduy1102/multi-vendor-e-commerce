'use client';

import { useCallback, useContext } from 'react';

import { RealtimeContext } from './realtime-context';

// Gửi một sự kiện lên server qua kết nối real-time. Trả hàm ổn định (không đổi identity giữa các lần render) nên dùng
// được trong deps của effect/callback. Hàm trả `true` nếu sự kiện đã giao cho socket đang kết nối, `false` nếu
// không gửi (khách vãng lai, chưa nối, đang nối lại, không có RealtimeProvider): nơi gọi (vd báo "đang gõ") coi
// `false` là "bỏ qua", không thử lại — sự kiện chỉ có nghĩa ngay lúc này.
export function useRealtimeEmit(): (event: string, payload?: unknown) => boolean {
  const client = useContext(RealtimeContext);
  return useCallback(
    (event: string, payload?: unknown) => (client ? client.emitEvent(event, payload) : false),
    [client],
  );
}
