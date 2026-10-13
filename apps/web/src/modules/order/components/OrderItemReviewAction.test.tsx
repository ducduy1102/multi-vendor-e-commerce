import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import en from '../../../../messages/en.json';
import type { OrderDetailItem } from '../types';
import { OrderItemReviewAction } from './OrderItemReviewAction';

type Review = NonNullable<OrderDetailItem['review']>;

const REVIEW: Review = { id: 'review-1', rating: 4, comment: 'Tốt', editedAt: null, canEdit: true };

function renderAction(props: { canReview: boolean; review: Review | null }) {
  const onWrite = vi.fn();
  const onEdit = vi.fn();
  const utils = render(
    withIntl(<OrderItemReviewAction {...props} onWrite={onWrite} onEdit={onEdit} />),
  );
  return { ...utils, onWrite, onEdit };
}

describe('OrderItemReviewAction', () => {
  it('được phép và chưa đánh giá -> nút "Viết đánh giá"', async () => {
    const user = userEvent.setup();
    const { onWrite, onEdit } = renderAction({ canReview: true, review: null });

    await user.click(screen.getByRole('button', { name: 'Viết đánh giá' }));

    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByText('Đã đánh giá')).not.toBeInTheDocument();
  });

  it('không được phép và chưa đánh giá (đơn chưa hoàn tất, hết hạn...) -> không render gì', () => {
    const { container } = renderAction({ canReview: false, review: null });

    expect(container).toBeEmptyDOMElement();
  });

  it('đã đánh giá, còn sửa được -> "Đã đánh giá" + sao đã chấm + nút "Sửa" (không còn nút "Viết đánh giá")', async () => {
    const user = userEvent.setup();
    const { onEdit, onWrite } = renderAction({ canReview: false, review: REVIEW });

    expect(screen.getByText('Đã đánh giá')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '4 trên 5 sao' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Viết đánh giá' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sửa' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('đã đánh giá nhưng hết lần sửa -> vẫn hiện "Đã đánh giá ★n", KHÔNG có nút "Sửa"', () => {
    renderAction({ canReview: false, review: { ...REVIEW, canEdit: false } });

    expect(screen.getByText('Đã đánh giá')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '4 trên 5 sao' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('có đánh giá được xét TRƯỚC cờ canReview (đề phòng cả hai cùng bật): không hiện "Viết đánh giá"', () => {
    renderAction({ canReview: true, review: REVIEW });

    expect(screen.queryByRole('button', { name: 'Viết đánh giá' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sửa' })).toBeInTheDocument();
  });

  it('nút đủ lớn trên mobile (cao tối thiểu 36px)', () => {
    const { unmount } = renderAction({ canReview: true, review: null });
    expect(screen.getByRole('button', { name: 'Viết đánh giá' })).toHaveClass('min-h-9');
    unmount();

    renderAction({ canReview: false, review: REVIEW });
    expect(screen.getByRole('button', { name: 'Sửa' })).toHaveClass('min-h-9');
  });

  it('tiếng Anh: "Write a review" / "Reviewed" + "Edit"', () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <OrderItemReviewAction canReview review={null} onWrite={() => {}} onEdit={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Write a review' })).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <OrderItemReviewAction
          canReview={false}
          review={REVIEW}
          onWrite={() => {}}
          onEdit={() => {}}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Reviewed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });
});
