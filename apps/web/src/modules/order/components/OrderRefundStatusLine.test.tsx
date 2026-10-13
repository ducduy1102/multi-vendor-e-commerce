import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { OrderListItem } from '../types';
import { OrderRefundStatusLine } from './OrderRefundStatusLine';
import { RefundRequestStatusBadge } from './RefundRequestStatusBadge';

type Request = NonNullable<OrderListItem['refundRequest']>;

const request = (overrides: Partial<Request>): Request => ({
  id: 'request-1',
  kind: 'CANCEL',
  status: 'PENDING_SELLER',
  reasonCode: 'CHANGE_OF_MIND',
  reasonNote: null,
  sellerRespondBy: '2026-10-03T03:00:00.000Z',
  statusChangedAt: '2026-10-01T03:00:00.000Z',
  createdAt: '2026-10-01T03:00:00.000Z',
  history: [],
  canWithdraw: false,
  canEscalate: false,
  ...overrides,
});

describe('OrderRefundStatusLine', () => {
  it('không có yêu cầu -> không render gì', () => {
    const { container } = render(withIntl(<OrderRefundStatusLine request={null} />));

    expect(container).toBeEmptyDOMElement();
  });

  it('có yêu cầu hủy đang chờ shop: tên loại yêu cầu + huy hiệu trạng thái', () => {
    render(withIntl(<OrderRefundStatusLine request={request({})} />));

    expect(screen.getByText('Yêu cầu hủy đơn')).toBeInTheDocument();
    expect(screen.getByText('Chờ shop phản hồi')).toBeInTheDocument();
  });

  it('yêu cầu trả hàng bị shop từ chối: đúng loại và đúng trạng thái', () => {
    render(
      withIntl(
        <OrderRefundStatusLine
          request={request({ kind: 'RETURN', status: 'REJECTED_BY_SELLER' })}
        />,
      ),
    );

    expect(screen.getByText('Yêu cầu trả hàng/hoàn tiền')).toBeInTheDocument();
    expect(screen.getByText('Shop đã từ chối')).toBeInTheDocument();
  });
});

describe('RefundRequestStatusBadge', () => {
  it('bị shop từ chối dùng tông cảnh báo, đã chấp thuận dùng tông thành công, chờ xử lý dùng tông trung tính — không đỏ', () => {
    const { rerender } = render(withIntl(<RefundRequestStatusBadge status="REJECTED_BY_SELLER" />));
    expect(screen.getByText('Shop đã từ chối')).toHaveClass('bg-warning/15');

    rerender(withIntl(<RefundRequestStatusBadge status="APPROVED" />));
    expect(screen.getByText('Đã chấp thuận')).toHaveClass('text-success');

    rerender(withIntl(<RefundRequestStatusBadge status="PENDING_SELLER" />));
    expect(screen.getByText('Chờ shop phản hồi')).toHaveClass('bg-secondary');

    for (const status of ['REJECTED', 'WITHDRAWN', 'ESCALATED'] as const) {
      rerender(withIntl(<RefundRequestStatusBadge status={status} />));
      expect(document.querySelector('[class*="bg-destructive"]')).toBeNull();
    }
  });

  it('nhận className ngoài', () => {
    render(withIntl(<RefundRequestStatusBadge status="APPROVED" className="shrink-0" />));

    expect(screen.getByText('Đã chấp thuận')).toHaveClass('shrink-0');
  });
});
