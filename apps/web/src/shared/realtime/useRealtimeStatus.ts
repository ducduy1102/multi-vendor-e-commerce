'use client';

import { useContext, useSyncExternalStore } from 'react';

import type { RealtimeStatus } from './realtime-client';
import { RealtimeContext } from './realtime-context';

const noopSubscribe = () => () => {};
const offline = (): RealtimeStatus => 'offline';

// Trạng thái kết nối hiện tại: 'connected' (đang nhận sự kiện), 'connecting' (đang nối hoặc chờ nối lại) hoặc
// 'offline' (không nối: khách vãng lai, đã dừng, hoặc tab ẩn đang chờ hiện lại). Phía server (SSR) luôn là
// 'offline' — trạng thái thật chỉ có ở trình duyệt.
export function useRealtimeStatus(): RealtimeStatus {
  const client = useContext(RealtimeContext);
  return useSyncExternalStore(
    client ? client.subscribeStatus : noopSubscribe,
    client ? client.getStatus : offline,
    offline,
  );
}
