import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import type { Review } from '../types';
import { ReviewItem } from './ReviewItem';

const REVIEW: Review = {
  id: 'review-1',
  rating: 4,
  comment: 'Áo đẹp, giao nhanh',
  createdAt: '2026-10-01T05:00:00.000Z',
  editedAt: null,
  reviewerName: 'N***',
  sellerReply: null,
  sellerRepliedAt: null,
};

function renderItem(overrides: Partial<Review> = {}) {
  return render(
    withIntl(
      <ul>
        <ReviewItem review={{ ...REVIEW, ...overrides }} />
      </ul>,
    ),
  );
}

describe('ReviewItem', () => {
  it('hiện sao, tên đã che, ngày và nội dung', () => {
    renderItem();

    expect(screen.getByRole('img', { name: '4 trên 5 sao' })).toBeInTheDocument();
    expect(screen.getByText('N***')).toBeInTheDocument();
    expect(screen.getByText('Áo đẹp, giao nhanh')).toBeInTheDocument();
    expect(screen.getByText('1 thg 10, 2026')).toHaveAttribute('datetime', REVIEW.createdAt);
  });

  it('ngày hiển thị theo giờ Việt Nam, không theo giờ máy chủ (23:30 UTC ngày 30 = 06:30 ngày 1)', () => {
    renderItem({ createdAt: '2026-09-30T23:30:00.000Z' });

    expect(screen.getByText('1 thg 10, 2026')).toBeInTheDocument();
  });

  it('chưa chỉnh sửa: không có nhãn "Đã chỉnh sửa"; đã chỉnh sửa: có nhãn', () => {
    const { unmount } = renderItem();
    expect(screen.queryByText(/Đã chỉnh sửa/)).not.toBeInTheDocument();
    unmount();

    renderItem({ editedAt: '2026-10-02T00:00:00.000Z' });
    expect(screen.getByText(/Đã chỉnh sửa/)).toBeInTheDocument();
  });

  it('không có nhận xét: không render đoạn nội dung rỗng', () => {
    const { container } = renderItem({ comment: null });

    expect(container.querySelector('p')).toBeNull();
  });

  it('không có trả lời: không có khối "Phản hồi của shop"', () => {
    renderItem();

    expect(screen.queryByText('Phản hồi của shop')).not.toBeInTheDocument();
  });

  it('có trả lời của shop: hiện khối kèm nội dung và ngày trả lời', () => {
    renderItem({
      sellerReply: 'Cảm ơn bạn đã ủng hộ shop!',
      sellerRepliedAt: '2026-10-03T05:00:00.000Z',
    });

    expect(screen.getByText('Phản hồi của shop')).toBeInTheDocument();
    expect(screen.getByText('Cảm ơn bạn đã ủng hộ shop!')).toBeInTheDocument();
    expect(screen.getByText('3 thg 10, 2026')).toHaveAttribute(
      'datetime',
      '2026-10-03T05:00:00.000Z',
    );
  });

  it('giữ xuống dòng trong nội dung và cho phép ngắt chuỗi dài (nhận xét/trả lời là chữ người dùng nhập)', () => {
    renderItem({ comment: 'a'.repeat(500), sellerReply: 'b'.repeat(500) });

    const comment = screen.getByText('a'.repeat(500));
    const reply = screen.getByText('b'.repeat(500));
    for (const node of [comment, reply]) {
      expect(node).toHaveClass('break-words', 'whitespace-pre-line');
    }
    // Lưới khai cột tường minh ở cả hàng đánh giá lẫn khối trả lời.
    expect(screen.getByRole('listitem')).toHaveClass('grid-cols-1');
    expect(reply.parentElement).toHaveClass('grid-cols-1');
    // Tên người đánh giá nằm trong hàng flex nên cần min-w-0 để co lại được.
    expect(screen.getByText('N***')).toHaveClass('min-w-0', 'break-words');
  });

  describe('khe header/footer cho phía seller', () => {
    it('không truyền -> trang sản phẩm công khai không có phần tử thừa nào (chỉ sao/tên/ngày/nội dung)', () => {
      renderItem();

      expect(screen.getByRole('listitem').children).toHaveLength(2);
    });

    it('header đứng TRƯỚC hàng sao, footer đứng SAU khối trả lời (thứ tự DOM)', () => {
      render(
        withIntl(
          <ul>
            <ReviewItem
              review={{ ...REVIEW, sellerReply: 'Cảm ơn!', sellerRepliedAt: REVIEW.createdAt }}
              header={<span>Tên sản phẩm</span>}
              footer={<button type="button">Sửa câu trả lời</button>}
            />
          </ul>,
        ),
      );

      const header = screen.getByText('Tên sản phẩm');
      const stars = screen.getByRole('img', { name: '4 trên 5 sao' });
      const reply = screen.getByText('Cảm ơn!');
      const footer = screen.getByRole('button', { name: 'Sửa câu trả lời' });
      const before = (a: Node, b: Node) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(before(header, stars)).toBeTruthy();
      expect(before(reply, footer)).toBeTruthy();
    });
  });
});
