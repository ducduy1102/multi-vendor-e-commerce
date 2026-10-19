'use client';

import { createContext } from 'react';

import type { RealtimeClient } from './realtime-client';

// null = không có RealtimeProvider phía trên (vd test một component riêng lẻ): hook dùng context này phải coi
// là "ngoại tuyến" và không làm gì, thay vì ném lỗi.
export const RealtimeContext = createContext<RealtimeClient | null>(null);
