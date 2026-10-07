import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { ShopStatus } from '../types';
import { AdminShopActions } from './AdminShopActions';

function setup(status: ShopStatus, isDisabled = false) {
  const handlers = {
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onSuspend: vi.fn(),
    onUnsuspend: vi.fn(),
  };
  const utils = render(
    withIntl(
      <AdminShopActions status={status} shopName="Shop A" isDisabled={isDisabled} {...handlers} />,
    ),
  );
  return { ...utils, ...handlers };
}

function buttonNames() {
  return screen.queryAllByRole('button').map((button) => button.textContent);
}

describe('AdminShopActions', () => {
  it('shop chờ duyệt: "Duyệt" và "Từ chối", bấm gọi đúng callback', async () => {
    const user = userEvent.setup();
    const { onApprove, onReject, onSuspend, onUnsuspend } = setup('PENDING');

    expect(buttonNames()).toEqual(['Duyệt', 'Từ chối']);
    await user.click(screen.getByRole('button', { name: 'Duyệt: Shop A' }));
    await user.click(screen.getByRole('button', { name: 'Từ chối: Shop A' }));

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onSuspend).not.toHaveBeenCalled();
    expect(onUnsuspend).not.toHaveBeenCalled();
  });

  it('shop đã duyệt: chỉ "Khoá"', async () => {
    const user = userEvent.setup();
    const { onSuspend } = setup('APPROVED');

    expect(buttonNames()).toEqual(['Khoá']);
    await user.click(screen.getByRole('button', { name: 'Khoá: Shop A' }));

    expect(onSuspend).toHaveBeenCalledTimes(1);
  });

  it('shop đang bị khoá: chỉ "Mở khoá" (khác "Duyệt" dù cùng đích APPROVED)', async () => {
    const user = userEvent.setup();
    const { onUnsuspend, onApprove } = setup('SUSPENDED');

    expect(buttonNames()).toEqual(['Mở khoá']);
    await user.click(screen.getByRole('button', { name: 'Mở khoá: Shop A' }));

    expect(onUnsuspend).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('shop đã bị từ chối (trạng thái cuối ở Tuần 8): không render gì', () => {
    const { container } = setup('REJECTED');

    expect(container).toBeEmptyDOMElement();
  });

  it('tên accessible gắn tên shop để phân biệt nhiều nút giống nhau trên cùng trang, và vẫn chứa chữ hiển thị', () => {
    setup('PENDING');

    const approve = screen.getByRole('button', { name: /Duyệt/ });
    expect(approve).toHaveAccessibleName('Duyệt: Shop A');
    expect(approve).toHaveTextContent('Duyệt');
  });

  it('đang có hành động chạy (isDisabled) -> khoá mọi nút, bấm không gọi callback', async () => {
    const user = userEvent.setup();
    const { onApprove, onReject } = setup('PENDING', true);

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
    await user.click(screen.getByRole('button', { name: 'Duyệt: Shop A' }));
    await user.click(screen.getByRole('button', { name: 'Từ chối: Shop A' }));

    expect(onApprove).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });
});
