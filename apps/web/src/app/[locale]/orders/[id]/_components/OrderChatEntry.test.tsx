import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrderChatEntry } from './OrderChatEntry';

const order = { data: undefined as { shop: { id: string } } | undefined };
const useOrder = vi.fn();
const chatButton = vi.fn();

vi.mock('@/modules/order', () => ({
  useOrder: (orderId: string) => {
    useOrder(orderId);
    return order;
  },
}));
vi.mock('@/modules/chat', () => ({
  ShopChatButton: (props: unknown) => {
    chatButton(props);
    return <button type="button">chat-button</button>;
  },
}));

describe('OrderChatEntry (nút "Chat với shop" ở chi tiết đơn của người mua)', () => {
  beforeEach(() => {
    order.data = undefined;
    useOrder.mockReset();
    chatButton.mockReset();
  });

  it('đơn chưa có dữ liệu (đang tải / không tìm thấy): không dựng nút', () => {
    const { container } = render(<OrderChatEntry orderId="order-1" />);

    expect(container).toBeEmptyDOMElement();
    expect(chatButton).not.toHaveBeenCalled();
  });

  it('có đơn: nút trỏ đúng SHOP CỦA ĐƠN và coi người xem đã đăng nhập (route /orders đã bị proxy chặn khách)', () => {
    order.data = { shop: { id: 'shop-of-order' } };
    render(<OrderChatEntry orderId="order-1" />);

    expect(screen.getByRole('button', { name: 'chat-button' })).toBeInTheDocument();
    expect(chatButton).toHaveBeenCalledWith({ shopId: 'shop-of-order', isAuthenticated: true });
  });

  it('dùng đúng truy vấn của đơn đang xem (cùng khoá với container ⇒ dùng chung cache)', () => {
    order.data = { shop: { id: 'shop-of-order' } };
    render(<OrderChatEntry orderId="order-42" />);

    expect(useOrder).toHaveBeenCalledWith('order-42');
  });
});
