import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { Address } from '../types';
import { AddressRadioList } from './AddressRadioList';

function address(overrides: Partial<Address> = {}): Address {
  return {
    id: 'address-1',
    recipientName: 'Nguyễn Văn A',
    phone: '0912345678',
    line1: '12 Nguyễn Huệ',
    ward: 'Phường Bến Nghé',
    province: 'Hồ Chí Minh',
    isDefault: false,
    createdAt: '2026-09-27T00:00:00.000Z',
    ...overrides,
  };
}

function renderList(addresses: Address[], selectedId: string | null = null) {
  const onSelect = vi.fn();
  render(
    withIntl(
      <AddressRadioList addresses={addresses} selectedId={selectedId} onSelect={onSelect} />,
    ),
  );
  return { onSelect };
}

describe('AddressRadioList', () => {
  it('không có địa chỉ nào -> hiện trạng thái rỗng, không có radio', () => {
    renderList([]);

    expect(screen.getByText('Bạn chưa có địa chỉ nào.')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('hiện đủ thông tin từng địa chỉ, chỉ mặc định mới có badge', () => {
    renderList([
      address({ id: 'a1', isDefault: true }),
      address({
        id: 'a2',
        recipientName: 'Trần Thị B',
        line1: '20 Lê Lợi',
        isDefault: false,
      }),
    ]);

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(screen.getByText('12 Nguyễn Huệ, Phường Bến Nghé, Hồ Chí Minh')).toBeInTheDocument();
    expect(screen.getByText('20 Lê Lợi, Phường Bến Nghé, Hồ Chí Minh')).toBeInTheDocument();
    expect(screen.getAllByText('Mặc định')).toHaveLength(1);
  });

  it('địa chỉ khớp selectedId được chọn sẵn', () => {
    renderList([address({ id: 'a1' }), address({ id: 'a2' })], 'a2');

    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios[0].checked).toBe(false);
    expect(radios[1].checked).toBe(true);
  });

  it('bấm 1 địa chỉ -> gọi onSelect với đúng id', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderList([address({ id: 'a1' }), address({ id: 'a2' })]);

    await user.click(screen.getAllByRole('radio')[1]);

    expect(onSelect).toHaveBeenCalledWith('a2');
  });

  it('cùng 1 name cho mọi radio (đúng 1 lựa chọn tại 1 thời điểm)', () => {
    renderList([address({ id: 'a1' }), address({ id: 'a2' })]);

    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios[0].name).toBe(radios[1].name);
    expect(radios[0].name).not.toBe('');
  });
});
