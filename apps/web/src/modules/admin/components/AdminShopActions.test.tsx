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

describe('AdminShopActions — phân cấp nút và bố cục cột Thao tác (Week11.md 4.5)', () => {
  function setupFull(status: ShopStatus) {
    render(
      withIntl(
        <AdminShopActions
          status={status}
          shopName="Shop A"
          isDisabled={false}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onSuspend={vi.fn()}
          onUnsuspend={vi.fn()}
          onCancelOrders={vi.fn()}
          onOpenNotes={vi.fn()}
        />,
      ),
    );
  }

  const isSolid = (name: string) =>
    screen.getByRole('button', { name }).className.includes('bg-primary');

  it('shop chờ duyệt: "Duyệt" là nút đặc đứng đầu, "Từ chối" và "Ghi chú" là nút phụ bên dưới', () => {
    setupFull('PENDING');

    expect(buttonNames()).toEqual(['Duyệt', 'Từ chối', 'Ghi chú']);
    expect(isSolid('Duyệt: Shop A')).toBe(true);
    expect(isSolid('Từ chối: Shop A')).toBe(false);
    expect(isSolid('Ghi chú: Shop A')).toBe(false);
  });

  it('shop đang bị khoá: "Mở khoá" là nút đặc đứng đầu (hành động chính, như "Duyệt"), hủy đơn và ghi chú ở dưới', () => {
    setupFull('SUSPENDED');

    expect(buttonNames()).toEqual(['Mở khoá', 'Hủy đơn chưa giao', 'Ghi chú']);
    expect(isSolid('Mở khoá: Shop A')).toBe(true);
    expect(isSolid('Hủy đơn chưa giao: Shop A')).toBe(false);
    expect(isSolid('Ghi chú: Shop A')).toBe(false);
  });

  it('shop đã duyệt: "Khoá" mang tính cẩn trọng nên KHÔNG là nút đặc dù là hành động duy nhất', () => {
    setupFull('APPROVED');

    expect(buttonNames()).toEqual(['Khoá', 'Ghi chú']);
    expect(isSolid('Khoá: Shop A')).toBe(false);
  });

  it('mọi nút cùng chiều cao tối thiểu 36px; từ 3 nút cụm xếp dọc và giãn đủ bề rộng cột từ `lg` (như bảng hoàn tiền)', () => {
    setupFull('SUSPENDED');

    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass('min-h-9');
    }
    const group = screen.getAllByRole('button')[0].parentElement;
    expect(group).toHaveClass('lg:flex-col', 'lg:items-stretch');
    expect(group).not.toHaveClass('lg:justify-end');
  });

  it.each<[ShopStatus, boolean]>([
    ['PENDING', true], // Duyệt + Từ chối + Ghi chú
    ['SUSPENDED', true], // Mở khoá + Hủy đơn + Ghi chú
    ['APPROVED', false], // Khoá + Ghi chú: một hàng gọn, hàng bảng không cao lên
    ['REJECTED', false], // chỉ Ghi chú
  ])('shop %s: xếp dọc đủ cột = %s, ngược lại một hàng gọn căn phải', (status, isStacked) => {
    setupFull(status);

    const group = screen.getAllByRole('button')[0].parentElement;
    if (isStacked) {
      expect(group).toHaveClass('lg:flex-col', 'lg:items-stretch');
      expect(group).not.toHaveClass('lg:justify-end');
    } else {
      expect(group).toHaveClass('lg:justify-end');
      expect(group).not.toHaveClass('lg:flex-col');
    }
  });

  it('số nút tính theo nút thật sự có: chờ duyệt mà nơi dùng không truyền Ghi chú chỉ có 2 nút ⇒ một hàng gọn', () => {
    setup('PENDING');

    const group = screen.getAllByRole('button')[0].parentElement;
    expect(group).toHaveClass('lg:justify-end');
  });

  it.each<[ShopStatus, string]>([
    ['APPROVED', 'Khoá: Shop A'],
    ['PENDING', 'Từ chối: Shop A'],
    ['SUSPENDED', 'Hủy đơn chưa giao: Shop A'],
  ])(
    'shop %s: "%s" là nút viền cảnh báo — viền + chữ màu destructive, KHÔNG nền đỏ nhạt (3,97:1), rê chuột không đổi nền sang xám',
    (status, name) => {
      setupFull(status);

      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('border-destructive/30', 'text-destructive');
      expect(button).toHaveClass('hover:bg-background', 'hover:text-destructive');
      expect(button.className).not.toMatch(/(^|s)bg-destructive/);
      expect(button.className).not.toContain('bg-primary');
    },
  );

  it.each<[ShopStatus, string]>([
    ['PENDING', 'Duyệt: Shop A'],
    ['PENDING', 'Ghi chú: Shop A'],
    ['SUSPENDED', 'Mở khoá: Shop A'],
    ['SUSPENDED', 'Ghi chú: Shop A'],
    ['APPROVED', 'Ghi chú: Shop A'],
  ])(
    'shop %s: "%s" KHÔNG mang màu cảnh báo (nút chính và nút ghi chú giữ kiểu riêng)',
    (status, name) => {
      setupFull(status);

      expect(screen.getByRole('button', { name }).className).not.toContain('text-destructive');
    },
  );

  it('cặp đồng ý / từ chối của shop chờ duyệt tách bạch: "Duyệt" nút đặc, "Từ chối" nút viền đỏ', () => {
    setupFull('PENDING');

    expect(screen.getByRole('button', { name: 'Duyệt: Shop A' })).toHaveClass('bg-primary');
    expect(screen.getByRole('button', { name: 'Từ chối: Shop A' })).toHaveClass(
      'text-destructive',
      'bg-background',
    );
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
