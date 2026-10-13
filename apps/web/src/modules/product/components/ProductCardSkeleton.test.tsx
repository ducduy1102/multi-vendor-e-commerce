import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProductCardSkeleton } from './ProductCardSkeleton';

describe('ProductCardSkeleton', () => {
  it('khớp khối thông tin của ProductPreviewCard: tên 2 dòng + giá + hàng sao (4 thanh), tổng cao 84px như thẻ thật', () => {
    const { container } = render(<ProductCardSkeleton />);

    const info = container.querySelector('[data-slot="product-card-skeleton"] > div:last-child');
    const bars = info?.querySelectorAll('[data-slot="skeleton"]') ?? [];
    expect(bars).toHaveLength(4);
    // Thẻ thật: tên 2 dòng (2×20) + gap-1 + giá (20) + gap-1 + hàng sao h-4 (16) = 84px; thanh h-4/h-4/h-4/h-3
    // cách nhau gap-2 (8px) = 16+16+16+12 + 3×8 = 84px.
    expect([...bars].map((bar) => bar.className.match(/\bh-\d+(?:\.\d+)?\b/)?.[0])).toEqual([
      'h-4',
      'h-4',
      'h-4',
      'h-3',
    ]);
    expect(info).toHaveClass('gap-2');
  });

  it('thuần trang trí (aria-hidden) và tôn trọng prefers-reduced-motion', () => {
    const { container } = render(<ProductCardSkeleton />);

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    for (const bar of container.querySelectorAll('[data-slot="skeleton"]')) {
      expect(bar).toHaveClass('motion-reduce:animate-none');
    }
  });
});
