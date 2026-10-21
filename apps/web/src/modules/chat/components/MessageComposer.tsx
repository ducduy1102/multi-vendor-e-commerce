'use client';

import { CHAT_MESSAGE_MAX_LENGTH, chatMessageFormSchema } from '@ecommerce/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { SendHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, type KeyboardEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import type { ChatMessageFormInput } from '../types';

interface MessageComposerProps {
  // Gửi nội dung ĐÃ chuẩn hoá (trim, xuống dòng `\n`) và hợp lệ theo schema dùng chung với BE.
  onSend: (content: string) => void;
  // Gọi mỗi lần người dùng gõ (để báo "đang gõ"); nơi gọi tự giới hạn tần suất.
  onTyping?: () => void;
  // Lý do (đã dịch) ô nhập bị vô hiệu — vd hội thoại chỉ đọc. null = dùng được.
  disabledReason: string | null;
}

// Ô nhập tin (React Hook Form + schema dùng chung `chatMessageFormSchema` — cùng giới hạn 1.000 ký tự và bộ ký tự
// an toàn với BE). Enter gửi, Shift+Enter xuống dòng; KHÔNG gửi khi đang gõ bộ gõ tiếng Việt/IME dở (Enter lúc đó là
// xác nhận từ đang gõ, `isComposing` hoặc keyCode 229 trên Safari). Tin rỗng/chỉ khoảng trắng: nút gửi tắt, Enter bị
// bỏ qua (không hiện lỗi vô ích). Quá 1.000 ký tự: không cắt cụt âm thầm — bộ đếm đổi màu và lỗi hiện ngay khi gửi.
// Bị vô hiệu thì HIỆN LÝ DO bằng chữ (không chỉ làm mờ ô nhập). Mất mạng KHÔNG vô hiệu ô nhập: tin vẫn vào hộp chờ
// và hiện "Gửi lỗi — Thử lại" (đúng kỳ vọng ở các ứng dụng chat), lúc có mạng lại gửi tiếp được đúng khoá cũ.
export function MessageComposer({ onSend, onTyping, disabledReason }: MessageComposerProps) {
  const t = useTranslations('chat');
  const translateValidation = useValidationMessage();
  const fieldId = useId();
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<ChatMessageFormInput>({
    resolver: zodResolver(chatMessageFormSchema),
    defaultValues: { content: '' },
  });
  const content = useWatch({ control, name: 'content' });
  const isDisabled = disabledReason !== null;
  const isEmpty = content.trim() === '';
  const isTooLong = content.length > CHAT_MESSAGE_MAX_LENGTH;

  const submit = handleSubmit((values) => {
    onSend(values.content);
    reset({ content: '' });
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // Enter đang xác nhận từ của bộ gõ — không phải lệnh gửi.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!isEmpty && !isDisabled) void submit();
  };

  const field = register('content', { onChange: () => onTyping?.() });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!isEmpty && !isDisabled) void submit(event);
      }}
      noValidate
      className="grid grid-cols-1 gap-1.5 border-t border-border p-3"
    >
      <Label htmlFor={fieldId} className="sr-only">
        {t('composerLabel')}
      </Label>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
        <Textarea
          id={fieldId}
          rows={1}
          enterKeyHint="send"
          autoComplete="off"
          disabled={isDisabled}
          placeholder={t('composerPlaceholder')}
          aria-invalid={errors.content ? true : undefined}
          aria-describedby={`${fieldId}-hint`}
          onKeyDown={handleKeyDown}
          className="max-h-32 min-h-9 min-w-0 resize-none overflow-y-auto"
          {...field}
        />
        <Button
          type="submit"
          size="icon-lg"
          aria-label={t('composerSend')}
          disabled={isDisabled || isEmpty}
        >
          <SendHorizontal aria-hidden="true" />
        </Button>
      </div>

      <div
        id={`${fieldId}-hint`}
        className="flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5"
      >
        {isDisabled ? (
          <p role="status" className="min-w-0 text-xs break-words text-muted-foreground">
            {disabledReason}
          </p>
        ) : errors.content ? (
          <p role="alert" className="min-w-0 text-xs break-words text-destructive">
            {translateValidation(errors.content.message)}
          </p>
        ) : (
          <p className="hidden min-w-0 text-xs text-muted-foreground md:block">
            {t('composerHint')}
          </p>
        )}
        <p
          className={cn(
            'ml-auto shrink-0 text-xs tabular-nums',
            isTooLong ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {t('composerCounter', { count: content.length, max: CHAT_MESSAGE_MAX_LENGTH })}
        </p>
      </div>
    </form>
  );
}
