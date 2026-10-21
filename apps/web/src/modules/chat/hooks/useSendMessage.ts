import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { ApiError } from '@/shared/lib/api-client';

import * as chatService from '../services/chat.service';
import { useChatOutboxStore } from '../store/chat-outbox.store';
import type { ChatScope, ChatSendFailure } from '../types';
import { applyServerMessage } from './chat-realtime-handlers';
import { useStableChatScope } from './useStableChatScope';

interface SendVariables {
  scope: ChatScope;
  conversationId: string;
  content: string;
  clientMessageId: string;
}

function toFailure(error: unknown): ChatSendFailure {
  return error instanceof ApiError
    ? { status: error.status, ...(error.code ? { code: error.code } : {}) }
    : { status: 0 };
}

export interface UseSendMessageResult {
  // Gửi một tin MỚI (nội dung đã được form kiểm). Tin hiện NGAY trong danh sách ở trạng thái "đang gửi" (lạc quan).
  // Trả `clientMessageId` vừa sinh.
  send: (content: string) => string;
  // Thử lại một tin "gửi lỗi" bằng ĐÚNG `clientMessageId` cũ — server idempotent theo khoá đó nên không tạo bản sao
  // kể cả khi lần gửi trước thật ra đã thành công mà phản hồi bị mất (mất mạng đúng lúc).
  retry: (clientMessageId: string) => void;
  // Bỏ một tin "gửi lỗi" (người dùng không muốn thử lại).
  discard: (clientMessageId: string) => void;
  // Đang có ít nhất một tin chưa nhận được phản hồi.
  isSending: boolean;
}

// Gửi tin lạc quan (Week10.md 5.1). Luồng: bấm gửi → tin vào hộp chờ (`sending`) → POST → thành công thì áp tin thật
// vào cache và gỡ bản tạm; lỗi thì đánh dấu `failed` (GIỮ nội dung + khoá). Sự kiện real-time của chính tin này có
// thể tới TRƯỚC phản hồi HTTP (server đẩy trước khi trả lời) — cả hai đường dùng chung applyServerMessage nên thứ tự
// nào cũng ra cùng kết quả và không bao giờ hiện hai lần.
export function useSendMessage(scope: ChatScope, conversationId: string): UseSendMessageResult {
  const queryClient = useQueryClient();
  const stableScope = useStableChatScope(scope);

  const mutation = useMutation({
    mutationFn: ({
      scope: variableScope,
      conversationId: id,
      content,
      clientMessageId,
    }: SendVariables) => chatService.sendMessage(variableScope, id, { content, clientMessageId }),
    onSuccess: (message, variables) => {
      applyServerMessage(queryClient, variables.scope, message);
      // Phản hồi luôn mang `clientMessageId` (tin của chính mình), nhưng đừng dựa vào đó để dọn hộp chờ.
      useChatOutboxStore.getState().remove(variables.conversationId, variables.clientMessageId);
    },
    onError: (error, variables) => {
      useChatOutboxStore
        .getState()
        .markFailed(variables.conversationId, variables.clientMessageId, toFailure(error));
    },
  });
  const { mutate } = mutation;

  const send = useCallback(
    (content: string) => {
      const clientMessageId = crypto.randomUUID();
      useChatOutboxStore.getState().enqueue({
        clientMessageId,
        conversationId,
        senderRole: stableScope.role,
        content,
        createdAt: new Date().toISOString(),
      });
      mutate({ scope: stableScope, conversationId, content, clientMessageId });
      return clientMessageId;
    },
    [mutate, stableScope, conversationId],
  );

  const retry = useCallback(
    (clientMessageId: string) => {
      const item = useChatOutboxStore
        .getState()
        .byConversation[conversationId]?.find((entry) => entry.clientMessageId === clientMessageId);
      // Chỉ thử lại tin ĐANG ở trạng thái lỗi: tin đang gửi thì đã có một yêu cầu bay.
      if (!item || item.deliveryStatus !== 'failed') return;
      useChatOutboxStore.getState().markSending(conversationId, clientMessageId);
      mutate({ scope: stableScope, conversationId, content: item.content, clientMessageId });
    },
    [mutate, stableScope, conversationId],
  );

  const discard = useCallback(
    (clientMessageId: string) =>
      useChatOutboxStore.getState().remove(conversationId, clientMessageId),
    [conversationId],
  );

  return { send, retry, discard, isSending: mutation.isPending };
}
