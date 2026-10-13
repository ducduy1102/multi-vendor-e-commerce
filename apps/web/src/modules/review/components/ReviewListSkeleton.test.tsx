import { render } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import messages from '../../../../messages/vi.json';
import { REVIEW_SKELETON_ITEMS } from './ProductReviewList.constants';
import { ReviewListSkeleton } from './ReviewListSkeleton';

vi.mock('next-intl/server', () => ({
  getTranslations: (namespace: string) =>
    Promise.resolve(createTranslator({ locale: 'vi', messages, namespace: namespace as 'review' })),
}));

describe('ReviewListSkeleton', () => {
  it('vùng bọc aria-busy kèm dòng sr-only đã dịch, phần skeleton aria-hidden', async () => {
    const { container } = render(await ReviewListSkeleton());

    const section = container.querySelector('section');
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(section?.querySelector('.sr-only')).toHaveTextContent('Đang tải đánh giá...');
    expect(section?.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('giữ neo id="reviews" như khối thật (bấm lọc/chuyển trang vẫn trỏ đúng khi còn đang tải)', async () => {
    const { container } = render(await ReviewListSkeleton());

    expect(container.querySelector('section#reviews')).toBeInTheDocument();
  });

  it('có đúng 5 hàng phân bố và REVIEW_SKELETON_ITEMS dòng đánh giá giả', async () => {
    const { container } = render(await ReviewListSkeleton());

    expect(container.querySelectorAll('.h-8.w-full')).toHaveLength(5);
    expect(container.querySelectorAll('.border-b.py-4')).toHaveLength(REVIEW_SKELETON_ITEMS);
  });

  it('tôn trọng prefers-reduced-motion: mọi khối skeleton có motion-reduce:animate-none', async () => {
    const { container } = render(await ReviewListSkeleton());

    const blocks = container.querySelectorAll('[data-slot="skeleton"]');
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(block).toHaveClass('motion-reduce:animate-none');
  });
});
