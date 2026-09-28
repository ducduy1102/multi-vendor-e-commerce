'use client';

import { ImageOff, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';

import { Link } from '@/i18n/navigation';
import { formatPrice } from '@/modules/product';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';

import type { CartLine } from '../types';
import { QuantityStepper } from './QuantityStepper';

interface CartItemRowProps {
  line: CartLine;
  onQuantityChange: (line: CartLine, quantity: number) => void;
  onRemove: (line: CartLine) => void;
  // Đang có thao tác giỏ hàng chạy dở — khoá stepper/nút xoá chặn bấm chồng.
  isBusy: boolean;
}

// Component thuần trình bày, 1 markup duy nhất cho mọi breakpoint (flex-wrap
// tự xuống dòng ở mobile, không render 2 bản JSX theo breakpoint —
// rules/frontend.md mục 5). Item không khả dụng (Week6.md 1.9) vẫn hiện, mờ
// đi + badge, không có stepper, nhưng LUÔN xoá tay được.
export function CartItemRow({ line, onQuantityChange, onRemove, isBusy }: CartItemRowProps) {
  const t = useTranslations('cart');
  const isOutOfStock = line.isAvailable && line.stock < 1;
  const isOverStock = line.isAvailable && line.stock >= 1 && line.quantity > line.stock;
  const attributesLabel = line.attributes.map((a) => `${a.name}: ${a.value}`).join(' · ');

  return (
    <li className="flex flex-wrap items-start gap-3 px-3 py-3 sm:px-4">
      <div
        className={cn(
          'relative size-16 shrink-0 overflow-hidden rounded-md bg-muted',
          !line.isAvailable && 'opacity-60 grayscale',
        )}
      >
        {line.imageUrl ? (
          <Image src={line.imageUrl} alt="" fill sizes="64px" className="object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center" aria-hidden="true">
            <ImageOff className="size-5 text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
        <Link
          href={`/products/${line.productSlug}`}
          className={cn(
            'line-clamp-2 rounded-sm text-sm font-medium text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
            !line.isAvailable && 'text-muted-foreground',
          )}
        >
          {line.productName}
        </Link>
        {attributesLabel ? (
          <p className="text-xs text-muted-foreground">{attributesLabel}</p>
        ) : null}
        <p className="text-sm text-foreground">{formatPrice(line.unitPrice)}</p>
        {!line.isAvailable ? (
          <Badge variant="secondary" className="w-fit">
            {t('unavailableBadge')}
          </Badge>
        ) : null}
        {isOutOfStock ? (
          <p role="status" className="text-xs text-warning">
            {t('outOfStock')}
          </p>
        ) : null}
        {isOverStock ? (
          <p role="status" className="text-xs text-warning">
            {t('stockWarning', { count: line.stock })}
          </p>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-3">
        {line.isAvailable ? (
          <>
            <QuantityStepper
              value={line.quantity}
              max={Math.max(line.stock, 1)}
              disabled={isBusy || isOutOfStock}
              onChange={(quantity) => onQuantityChange(line, quantity)}
            />
            <p className="w-24 text-right text-sm font-semibold text-foreground">
              {formatPrice(line.lineTotal)}
            </p>
          </>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('removeItem', { name: line.productName })}
          disabled={isBusy}
          onClick={() => onRemove(line)}
        >
          <Trash2Icon />
        </Button>
      </div>
    </li>
  );
}
