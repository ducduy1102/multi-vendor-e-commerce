'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';

import { ChatAvatar } from './ChatAvatar';

interface ConversationHeaderProps {
  name: string;
  logoUrl: string | null;
  // Hội thoại chỉ đọc (shop bị khoá): hiện nhãn cạnh tên để người dùng hiểu vì sao ô nhập bị tắt.
  isReadOnly: boolean;
  // Quay lại danh sách — chỉ hiện ở màn hình hẹp, nơi danh sách và hội thoại là hai màn riêng.
  onBack: () => void;
}

// Thanh tiêu đề của khung hội thoại. Tên đối phương là chữ người dùng/chủ shop nhập: `min-w-0 flex-1 truncate` để
// một tên dài bị cắt thay vì đẩy rộng khung. Dùng flex (không lưới): nút quay lại bị `display:none` từ `md` sẽ làm
// lưới xếp lại cột.
export function ConversationHeader({ name, logoUrl, isReadOnly, onBack }: ConversationHeaderProps) {
  const t = useTranslations('chat');

  return (
    <div className="flex items-center gap-2 border-b border-border px-2 py-2 md:px-3">
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className="md:hidden"
        aria-label={t('backToList')}
        onClick={onBack}
      >
        <ArrowLeft aria-hidden="true" />
      </Button>
      <ChatAvatar name={name} logoUrl={logoUrl} />
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{name}</h2>
      {isReadOnly ? <Badge variant="outline">{t('readOnlyBadge')}</Badge> : null}
    </div>
  );
}
