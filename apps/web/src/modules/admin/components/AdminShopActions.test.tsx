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

describe('AdminShopActions — hủy hàng loạt đơn chưa giao (Week11.md 4.1)', () => {
  function setupWithCancel(status: ShopStatus, isDisabled = false) {
    const onCancelOrders = vi.fn();
    render(
      withIntl(
        <AdminShopActions
          status={status}
          shopName="Shop A"
          isDisabled={isDisabled}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onSuspend={vi.fn()}
          onUnsuspend={vi.fn()}
          onCancelOrders={onCancelOrders}
        />,
      ),
    );
    return { onCancelOrders };
  }

  it('shop đang bị khoá: có thêm nút "Hủy đơn chưa giao" (sau "Mở khoá"), bấm gọi đúng callback', async () => {
    const user = userEvent.setup();
    const { onCancelOrders } = setupWithCancel('SUSPENDED');

    expect(buttonNames()).toEqual(['Mở khoá', 'Hủy đơn chưa giao']);
    await user.click(screen.getByRole('button', { name: 'Hủy đơn chưa giao: Shop A' }));

    expect(onCancelOrders).toHaveBeenCalledTimes(1);
  });

  it.each<ShopStatus>(['PENDING', 'APPROVED', 'REJECTED'])(
    'shop %s: KHÔNG bao giờ có nút này dù nơi dùng truyền callback (chỉ shop đang bị khoá)',
    (status) => {
      setupWithCancel(status);

      expect(screen.queryByRole('button', { name: /Hủy đơn chưa giao/ })).not.toBeInTheDocument();
    },
  );

  it('nơi dùng không truyền callback -> shop bị khoá chỉ có "Mở khoá" như trước', () => {
    setup('SUSPENDED');

    expect(buttonNames()).toEqual(['Mở khoá']);
  });

  it('đang có thao tác chạy -> khoá cả nút này', () => {
    setupWithCancel('SUSPENDED', true);

    expect(screen.getByRole('button', { name: 'Hủy đơn chưa giao: Shop A' })).toBeDisabled();
  });
});

describe('AdminShopActions — nút Ghi chú (Week11.md 4.3)', () => {
  function setupWithNotes(status: ShopStatus, isDisabled = false) {
    const onOpenNotes = vi.fn();
    render(
      withIntl(
        <AdminShopActions
          status={status}
          shopName="Shop A"
          isDisabled={isDisabled}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onSuspend={vi.fn()}
          onUnsuspend={vi.fn()}
          onOpenNotes={onOpenNotes}
        />,
      ),
    );
    return { onOpenNotes };
  }

  it.each(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const)(
    'shop %s: có nút "Ghi chú" gắn tên shop và bấm gọi onOpenNotes',
    async (status) => {
      const user = userEvent.setup();
      const { onOpenNotes } = setupWithNotes(status);

      await user.click(screen.getByRole('button', { name: 'Ghi chú: Shop A' }));

      expect(onOpenNotes).toHaveBeenCalledTimes(1);
    },
  );

  it('shop đã bị từ chối (không còn hành động nào) vẫn có nút Ghi chú — chỉ nút đó', () => {
    setupWithNotes('REJECTED');

    expect(buttonNames()).toEqual(['Ghi chú']);
  });

  it('không truyền onOpenNotes ⇒ không có nút, và shop REJECTED vẫn không render gì (hành vi cũ)', () => {
    const { container } = setup('REJECTED');

    expect(screen.queryByRole('button', { name: /Ghi chú/ })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('khi một hành động khác đang chạy (isDisabled) nút Ghi chú vẫn dùng được: chỉ mở ngăn đọc, không đổi dữ liệu', () => {
    setupWithNotes('APPROVED', true);

    expect(screen.getByRole('button', { name: 'Khoá: Shop A' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ghi chú: Shop A' })).toBeEnabled();
  });
});
