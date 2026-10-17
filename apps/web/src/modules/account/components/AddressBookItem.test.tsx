import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Address } from '@/modules/checkout';
import { withIntl } from '@/shared/lib/test-i18n';

import { AddressBookItem } from './AddressBookItem';

const address: Address = {
  id: 'address-1',
  recipientName: 'Nguyễn Văn A',
  phone: '0912345678',
  line1: '12 Nguyễn Huệ',
  ward: 'Phường Bến Nghé',
  province: 'Hồ Chí Minh',
  isDefault: false,
  createdAt: '2026-10-01T00:00:00.000Z',
};

function setup(props: Partial<React.ComponentProps<typeof AddressBookItem>> = {}) {
  const handlers = { onEdit: vi.fn(), onDelete: vi.fn(), onSetDefault: vi.fn() };
  render(
    withIntl(
      <ul>
        <AddressBookItem address={address} isBusy={false} {...handlers} {...props} />
      </ul>,
    ),
  );
  return handlers;
}

describe('AddressBookItem', () => {
  it('hiện người nhận, số điện thoại và địa chỉ đầy đủ', () => {
    setup();

    expect(screen.getByText('Nguyễn Văn A · 0912345678')).toBeInTheDocument();
    expect(screen.getByText('12 Nguyễn Huệ, Phường Bến Nghé, Hồ Chí Minh')).toBeInTheDocument();
  });

  it('địa chỉ thường: không có nhãn "Mặc định", có nút "Đặt làm mặc định"', () => {
    setup();

    expect(screen.queryByText('Mặc định')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Đặt địa chỉ của Nguyễn Văn A làm mặc định' }),
    ).toBeInTheDocument();
  });

  it('địa chỉ mặc định: có nhãn "Mặc định", KHÔNG có nút đặt mặc định', () => {
    setup({ address: { ...address, isDefault: true } });

    expect(screen.getByText('Mặc định')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /làm mặc định/ })).not.toBeInTheDocument();
  });

  it('mỗi nút gọi đúng handler với địa chỉ của thẻ', async () => {
    const user = userEvent.setup();
    const handlers = setup();

    await user.click(screen.getByRole('button', { name: 'Sửa địa chỉ của Nguyễn Văn A' }));
    await user.click(screen.getByRole('button', { name: 'Xoá địa chỉ của Nguyễn Văn A' }));
    await user.click(
      screen.getByRole('button', { name: 'Đặt địa chỉ của Nguyễn Văn A làm mặc định' }),
    );

    expect(handlers.onEdit).toHaveBeenCalledWith(address);
    expect(handlers.onDelete).toHaveBeenCalledWith(address);
    expect(handlers.onSetDefault).toHaveBeenCalledWith(address);
  });

  it('đang có thao tác ghi (isBusy) -> khoá mọi nút, không bấm chồng', async () => {
    const user = userEvent.setup();
    const handlers = setup({ isBusy: true });

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
      await user.click(button);
    }

    expect(handlers.onEdit).not.toHaveBeenCalled();
    expect(handlers.onDelete).not.toHaveBeenCalled();
    expect(handlers.onSetDefault).not.toHaveBeenCalled();
  });

  it('địa chỉ dài không dấu cách: cột chữ ngắt được (break-words) và co được (min-w-0)', () => {
    setup({ address: { ...address, line1: 'X'.repeat(200) } });

    const text = screen.getByText(new RegExp('X{200}'));
    const column = text.parentElement as HTMLElement;
    expect(column).toHaveClass('min-w-0', 'break-words');
  });

  it('tên người nhận dài không dấu cách: span là flex item nên cũng phải co được (min-w-0)', () => {
    setup({ address: { ...address, recipientName: 'W'.repeat(100) } });

    const name = screen.getByText(new RegExp('W{100} · 0912345678'));
    expect(name).toHaveClass('min-w-0');
  });
});
