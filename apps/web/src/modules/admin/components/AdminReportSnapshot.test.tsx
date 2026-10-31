import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import {
  makeConversationReport,
  makeProductReport,
  makeReviewReport,
  makeShopReport,
} from '../admin-report.fixtures';
import { AdminReportSnapshot } from './AdminReportSnapshot';

afterEach(() => cleanup());

const renderSnapshot = (
  report: Parameters<typeof AdminReportSnapshot>[0]['report'],
  props: { isClamped?: boolean } = {},
  locale: 'vi' | 'en' = 'vi',
) => render(withIntl(<AdminReportSnapshot report={report} {...props} />, locale));

describe('AdminReportSnapshot', () => {
  it('đánh giá: sao, TÊN ĐẦY ĐỦ của tác giả (Admin được thấy), nội dung nguyên văn, sản phẩm', () => {
    renderSnapshot(makeReviewReport());

    expect(screen.getByRole('img', { name: '1 trên 5 sao' })).toBeInTheDocument();
    expect(screen.getByText('Nguyễn Văn Anh')).toBeInTheDocument();
    expect(screen.getByText(/ib Zalo 0901 234 567/)).toBeInTheDocument();
    expect(screen.getByText('Sản phẩm: Áo thun cotton cổ tròn unisex')).toBeInTheDocument();
  });

  it('đánh giá chỉ có sao (comment null): nói rõ, không để khoảng trống', () => {
    renderSnapshot(
      makeReviewReport({
        snapshot: {
          productId: 'c9d8e7f6-1234-4a5b-8c9d-abcdef000009',
          productName: 'Áo',
          rating: 5,
          comment: null,
          authorName: 'A',
        },
      }),
    );

    expect(screen.getByText('Đánh giá chỉ có số sao, không có nội dung.')).toBeInTheDocument();
  });

  it('chữ do người dùng nhập: ký tự HTML hiện nguyên chữ, chuỗi dài không dấu cách ngắt được', () => {
    const comment = '<img src=x onerror=alert(1)>' + 'x'.repeat(500);
    renderSnapshot(
      makeReviewReport({
        snapshot: {
          productId: 'c9d8e7f6-1234-4a5b-8c9d-abcdef000009',
          productName: 'Áo',
          rating: 3,
          comment,
          authorName: 'A',
        },
      }),
    );

    const text = screen.getByText(comment);
    expect(text.className).toContain('[overflow-wrap:anywhere]');
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('isClamped: rút gọn nội dung dài ở danh sách; mặc định (trang chi tiết) đọc đủ', () => {
    const { unmount } = renderSnapshot(makeReviewReport(), { isClamped: true });
    expect(screen.getByText(/ib Zalo/).className).toContain('line-clamp-4');
    unmount();

    renderSnapshot(makeReviewReport());
    expect(screen.getByText(/ib Zalo/).className).not.toContain('line-clamp');
  });

  it('shop: tên + đường dẫn; sản phẩm: tên + shop', () => {
    renderSnapshot(makeShopReport());
    expect(screen.getByText('Shop Hàng Hiệu Giá Sỉ')).toBeInTheDocument();
    expect(screen.getByText('/shops/hang-hieu-gia-si')).toBeInTheDocument();
    cleanup();

    renderSnapshot(makeProductReport());
    expect(screen.getByText('Dao bấm tự động lò xo 21cm')).toBeInTheDocument();
    expect(screen.getByText('Shop Tạp Hoá Nam Anh')).toBeInTheDocument();
  });

  it('hội thoại: CHỈ tên hai bên và vai người báo — không có nội dung tin nhắn nào', () => {
    renderSnapshot(makeConversationReport());

    expect(screen.getByText('Nguyễn Thị Hồng ↔ Gia Dụng Xinh')).toBeInTheDocument();
    expect(
      screen.getByText('Người báo là chủ shop. Nội dung tin nhắn không nằm trong báo cáo.'),
    ).toBeInTheDocument();
  });

  it('hội thoại do người mua báo ⇒ "người mua"; tiếng Anh dịch cả vai', () => {
    renderSnapshot(
      makeConversationReport({
        snapshot: { shopName: 'S', buyerName: 'B', reporterRole: 'BUYER' },
      }),
      {},
      'en',
    );

    expect(
      screen.getByText('Reported by the buyer. The message content is not part of the report.'),
    ).toBeInTheDocument();
  });
});
