'use client';

import type { RealtimeEventName } from '@ecommerce/types';
import { useContext, useEffect, useRef } from 'react';
import type { z } from 'zod';

import { RealtimeContext } from './realtime-context';

// Nghe một sự kiện server → client. Payload đi qua Zod TRƯỚC khi tới handler (rules/general.md mục 4: mọi dữ
// liệu từ bên ngoài phải validate): payload sai hình dạng bị bỏ qua im lặng — một gói hỏng/lạ không được làm sập
// giao diện hay kích hoạt handler với dữ liệu không tin cậy. Schema truyền tường minh (thay vì tra theo tên sự
// kiện) để mỗi module dùng đúng schema nằm cạnh thực thể của nó ở packages/types.
//
// `schema` nên là hằng số ở module scope (đổi identity thì phải đăng ký lại). `handler` thì không cần bọc
// useCallback: luôn gọi bản mới nhất qua ref, không phải đăng ký lại mỗi lần render.
export function useRealtimeEvent<T>(
  event: RealtimeEventName,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  handler: (payload: T) => void,
): void {
  const client = useContext(RealtimeContext);
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!client) return;
    return client.subscribeEvent(event, (payload) => {
      const parsed = schema.safeParse(payload);
      if (parsed.success) handlerRef.current(parsed.data);
    });
  }, [client, event, schema]);
}
