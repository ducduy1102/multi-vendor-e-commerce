'use client';

import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

import { cn } from '@/shared/lib/utils';

import { STAR_COUNT } from './StarRating';

interface StarRatingInputProps {
  // 1-5; undefined (hoặc 0) = chưa chọn.
  value: number | undefined;
  onChange: (value: number) => void;
  // Gọi khi focus RỜI KHỎI cả nhóm (không gọi khi chuyển giữa các sao trong nhóm) — khớp `onBlur` của
  // react-hook-form `Controller`.
  onBlur?: () => void;
  // Tên của cả nhóm cho trình đọc màn hình, đã dịch bởi nơi gọi (vd "Đánh giá của bạn").
  label: string;
  name?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}

// Chọn số sao: một nhóm radio thật (`<input type="radio">` ẩn bằng `sr-only`, sao là nhãn của nó) nên bàn
// phím có sẵn đúng chuẩn trình duyệt — Tab vào nhóm, mũi tên trái/lên và phải/xuống đổi lựa chọn, đọc được
// "3 sao, đã chọn, 3 trên 5" — không tự viết lại logic roving tabindex. Sao từ 1 đến số đã chọn tô đặc.
// Mỗi ô tối thiểu 44×44px (vùng bấm đủ lớn trên mobile) và có vòng focus-visible rõ khi dùng bàn phím (chuột
// bấm vào không hiện vòng). Màu chỉ dùng token ngữ nghĩa. Dùng với react-hook-form qua `Controller`.
export function StarRatingInput({
  value,
  onChange,
  onBlur,
  label,
  name,
  disabled = false,
  invalid = false,
  describedBy,
  className,
}: StarRatingInputProps) {
  const t = useTranslations('common');
  const generatedName = useId();
  const groupName = name ?? generatedName;
  const selected = value ?? 0;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onBlur?.();
      }}
      className={cn('inline-flex items-center', className)}
    >
      {Array.from({ length: STAR_COUNT }, (_, index) => {
        const starValue = index + 1;
        const isOn = starValue <= selected;
        return (
          <label
            key={starValue}
            className={cn(
              'flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <input
              type="radio"
              name={groupName}
              value={starValue}
              checked={starValue === selected}
              disabled={disabled}
              onChange={() => onChange(starValue)}
              className="sr-only"
            />
            <span className="sr-only">{t('starRatingOption', { count: starValue })}</span>
            <Star
              aria-hidden="true"
              data-state={isOn ? 'on' : 'off'}
              className={cn('size-7', isOn ? 'fill-current text-primary' : 'text-muted-foreground')}
            />
          </label>
        );
      })}
    </div>
  );
}
