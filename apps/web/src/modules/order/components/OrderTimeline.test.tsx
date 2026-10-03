import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { OrderHistoryEntry } from '../types';
import { OrderTimeline } from './OrderTimeline';

const entry = (overrides: Partial<OrderHistoryEntry>): OrderHistoryEntry => ({
  fromStatus: null,
  toStatus: 'PENDING',
  actorType: 'BUYER',
  note: null,
  createdAt: '2026-10-01T01:00:00.000Z',
  ...overrides,
});

// Lịch sử một đơn COD đã giao: BE trả cũ → mới.
const COD_SHIPPED: OrderHistoryEntry[] = [
  entry({
    fromStatus: null,
    toStatus: 'PENDING',
    actorType: 'BUYER',
    createdAt: '2026-10-01T01:00:00.000Z',
  }),
  entry({
    fromStatus: 'PENDING',
    toStatus: 'CONFIRMED',
    actorType: 'SELLER',
    createdAt: '2026-10-01T02:00:00.000Z',
  }),
  entry({
    fromStatus: 'CONFIRMED',
    toStatus: 'PACKED',
    actorType: 'SELLER',
    createdAt: '2026-10-01T03:00:00.000Z',
  }),
  entry({
    fromStatus: 'PACKED',
    toStatus: 'SHIPPING',
    actorType: 'SELLER',
    createdAt: '2026-10-01T04:00:00.000Z',
  }),
];

describe('OrderTimeline', () => {
  it('hiện mới nhất lên đầu (đảo thứ tự cũ → mới của BE)', () => {
    render(withIntl(<OrderTimeline history={COD_SHIPPED} />));

    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => within(item).getAllByText(/./)[0].textContent)).toEqual([
      'Đơn hàng đang được giao',
      'Shop đã đóng gói đơn hàng',
      'Shop đã xác nhận đơn hàng',
      'Đã đặt hàng, chờ shop xác nhận',
    ]);
  });

  it('chỉ bước mới nhất là bước hiện tại (aria-current="step")', () => {
    render(withIntl(<OrderTimeline history={COD_SHIPPED} />));

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('aria-current', 'step');
    for (const item of items.slice(1)) {
      expect(item).not.toHaveAttribute('aria-current');
    }
  });

  it('mỗi bước có thẻ <time> mang đúng thời điểm gốc (ISO) và hiện ngày giờ đã định dạng', () => {
    render(withIntl(<OrderTimeline history={COD_SHIPPED} />));

    const first = screen.getAllByRole('listitem')[0];
    const time = within(first).getByText(/2026/);
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-10-01T04:00:00.000Z');
  });

  it('đơn thanh toán online: "Đã đặt hàng, chờ thanh toán" rồi "Đã thanh toán, chờ shop xác nhận"', () => {
    render(
      withIntl(
        <OrderTimeline
          history={[
            entry({
              fromStatus: null,
              toStatus: 'AWAITING_PAYMENT',
              createdAt: '2026-10-01T01:00:00.000Z',
            }),
            entry({
              fromStatus: 'AWAITING_PAYMENT',
              toStatus: 'PENDING',
              actorType: 'SYSTEM',
              note: 'Payment confirmed',
              createdAt: '2026-10-01T01:05:00.000Z',
            }),
          ]}
        />,
      ),
    );

    expect(screen.getByText('Đã thanh toán, chờ shop xác nhận')).toBeInTheDocument();
    expect(screen.getByText('Đã đặt hàng, chờ thanh toán')).toBeInTheDocument();
  });

  it('shop từ chối kèm lý do -> hiện lý do của shop', () => {
    render(
      withIntl(
        <OrderTimeline
          history={[
            entry({ toStatus: 'PENDING' }),
            entry({
              fromStatus: 'PENDING',
              toStatus: 'CANCELLED',
              actorType: 'SELLER',
              note: 'Hết hàng',
              createdAt: '2026-10-01T02:00:00.000Z',
            }),
          ]}
        />,
      ),
    );

    expect(screen.getByText('Shop đã từ chối đơn hàng')).toBeInTheDocument();
    expect(screen.getByText('Lý do của shop: Hết hàng')).toBeInTheDocument();
  });

  it('người mua tự hủy không nhập lý do -> KHÔNG lộ ghi chú mặc định tiếng Anh của BE', () => {
    render(
      withIntl(
        <OrderTimeline
          history={[
            entry({ toStatus: 'PENDING' }),
            entry({
              fromStatus: 'PENDING',
              toStatus: 'CANCELLED',
              actorType: 'BUYER',
              note: 'Cancelled by buyer',
              createdAt: '2026-10-01T02:00:00.000Z',
            }),
          ]}
        />,
      ),
    );

    expect(screen.getByText('Bạn đã hủy đơn hàng')).toBeInTheDocument();
    expect(screen.queryByText(/Cancelled by buyer/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lý do của shop/)).not.toBeInTheDocument();
  });

  it('hết hạn thanh toán (hệ thống hủy) -> nói rõ lý do, không lộ "Payment hold reclaimed"', () => {
    render(
      withIntl(
        <OrderTimeline
          history={[
            entry({ fromStatus: null, toStatus: 'AWAITING_PAYMENT' }),
            entry({
              fromStatus: 'AWAITING_PAYMENT',
              toStatus: 'CANCELLED',
              actorType: 'SYSTEM',
              note: 'Payment hold reclaimed',
              createdAt: '2026-10-01T02:00:00.000Z',
            }),
          ]}
        />,
      ),
    );

    expect(screen.getByText('Đơn hàng bị hủy do hết thời hạn thanh toán')).toBeInTheDocument();
    expect(screen.queryByText(/Payment hold reclaimed/)).not.toBeInTheDocument();
  });

  it('ghi chú có HTML được hiển thị như văn bản, không chèn thẻ vào trang', () => {
    const { container } = render(
      withIntl(
        <OrderTimeline
          history={[
            entry({ toStatus: 'PENDING' }),
            entry({
              fromStatus: 'PENDING',
              toStatus: 'CANCELLED',
              actorType: 'SELLER',
              note: '<img src=x onerror=alert(1)>',
              createdAt: '2026-10-01T02:00:00.000Z',
            }),
          ]}
        />,
      ),
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
  });

  it('không có lịch sử -> không render gì', () => {
    const { container } = render(withIntl(<OrderTimeline history={[]} />));

    expect(container).toBeEmptyDOMElement();
  });

  it('không sửa mảng history truyền vào', () => {
    const history = [...COD_SHIPPED];
    const before = history.map((h) => h.toStatus);

    render(withIntl(<OrderTimeline history={history} />));

    expect(history.map((h) => h.toStatus)).toEqual(before);
  });
});
