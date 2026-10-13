import { Star } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@/shared/lib/utils';

// Số sao tối đa — cũng là mẫu số trong nhãn truy cập ("4,5 trên 5 sao"), nên truyền vào bản dịch thay vì
// gõ cứng "5" trong chuỗi.
export const STAR_COUNT = 5;

type StarRatingSize = 'sm' | 'md';

const STAR_SIZE_CLASS: Record<StarRatingSize, string> = {
  sm: 'size-3.5',
  md: 'size-5',
};

interface StarRatingProps {
  // Điểm 0-5, có thể lẻ (điểm trung bình). Ngoài khoảng hoặc không phải số thì kẹp về 0-5.
  value: number;
  size?: StarRatingSize;
  className?: string;
}

function clampRating(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), STAR_COUNT);
}

// Hàng sao CHỈ ĐỌC (điểm trung bình trên card sản phẩm, tóm tắt đánh giá, từng đánh giá). Sao lẻ vẽ bằng
// lớp sao đặc phủ lên sao viền, cắt theo % chiều ngang của riêng ngôi sao đó (4,3 ⇒ 4 sao đầy + sao thứ 5
// phủ 30%), không làm tròn lên nửa sao. Cả hàng là MỘT ảnh với nhãn dịch sẵn ("4,5 trên 5 sao"); từng ngôi
// sao `aria-hidden` để trình đọc màn hình không đọc 5 lần. Màu chỉ dùng token ngữ nghĩa (`text-primary` cho
// sao đặc, `text-muted-foreground` cho sao viền) — accent cam dành cho điểm nhấn khác, không dùng cho sao.
//
// Không có "use client" và chỉ dùng hook của next-intl (chạy được ở cả Server lẫn Client Component) nên
// ProductPreviewCard vẫn là Server Component. Nơi gọi tự ẩn khi `reviewCount = 0` — component không biết số
// đánh giá, 0 sao là một giá trị hợp lệ để vẽ (sao viền cả hàng).
export function StarRating({ value, size = 'sm', className }: StarRatingProps) {
  const t = useTranslations('common');
  const format = useFormatter();
  const rating = clampRating(value);
  const sizeClass = STAR_SIZE_CLASS[size];
  // Số hiển thị theo locale (vi: "4,5", en: "4.5"), tối đa 1 chữ số thập phân; phần vẽ dùng giá trị chính xác.
  const label = t('starRatingLabel', {
    rating: format.number(rating, { maximumFractionDigits: 1 }),
    max: STAR_COUNT,
  });

  return (
    <span
      role="img"
      aria-label={label}
      className={cn('inline-flex items-center gap-0.5', className)}
    >
      {Array.from({ length: STAR_COUNT }, (_, index) => {
        const fill = Math.min(Math.max(rating - index, 0), 1);
        return (
          <span
            key={index}
            aria-hidden="true"
            className={cn('relative inline-block shrink-0', sizeClass)}
          >
            <Star className="absolute inset-0 size-full text-muted-foreground" />
            {fill > 0 && (
              <span
                data-slot="star-fill"
                className="absolute inset-y-0 left-0 overflow-hidden"
                style={{ width: `${fill * 100}%` }}
              >
                <Star className={cn('shrink-0 fill-current text-primary', sizeClass)} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
