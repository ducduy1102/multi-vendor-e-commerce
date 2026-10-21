'use client';

import { useImageFallback } from '@/shared/hooks/useImageFallback';
import { toSafeImageUrl } from '@/shared/lib/safe-image-url';
import { cn } from '@/shared/lib/utils';

import { initialsOf } from '../chat-format';
import { AVATAR_CLASS } from './chat-layout.constants';

interface ChatAvatarProps {
  name: string;
  // Logo shop (chủ shop nhập, bất kỳ host nào). Người mua không có ảnh đại diện ⇒ null ⇒ chữ cái đầu.
  logoUrl?: string | null;
  className?: string;
}

// Ảnh đại diện của đối phương: logo shop nếu có và an toàn (chỉ https), không thì chữ cái đầu của tên. Logo là URL tuỳ
// ý nên KHÔNG dùng next/image (host lạ làm nó ném lỗi) — `<img>` thường kèm `referrerPolicy="no-referrer"`, ảnh lỗi rơi
// về chữ cái đầu. Ảnh trang trí (`alt=""`): tên đối phương luôn có ngay cạnh.
export function ChatAvatar({ name, logoUrl, className }: ChatAvatarProps) {
  const src = toSafeImageUrl(logoUrl);
  const { isShown, imgRef, onError } = useImageFallback(src);

  return isShown && src ? (
    // eslint-disable-next-line @next/next/no-img-element -- URL tuỳ ý của chủ shop, xem comment trên.
    <img
      ref={imgRef}
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={onError}
      className={cn(AVATAR_CLASS, 'border border-border bg-muted object-cover', className)}
    />
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        AVATAR_CLASS,
        'flex items-center justify-center bg-primary/10 text-sm font-semibold text-primary',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
