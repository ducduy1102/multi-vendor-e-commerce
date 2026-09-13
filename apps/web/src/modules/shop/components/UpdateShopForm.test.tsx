import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { UpdateShopForm } from './UpdateShopForm';

const defaultValues = {
  name: 'Shop Thời Trang ABC',
  description: 'Mô tả cũ',
  logoUrl: 'https://example.com/logo.png',
  bannerUrl: 'https://example.com/banner.png',
};

describe('UpdateShopForm', () => {
  it('pre-fills fields with the current shop values', () => {
    render(withIntl(<UpdateShopForm defaultValues={defaultValues} onSubmit={vi.fn()} />));

    expect(screen.getByLabelText('Tên shop')).toHaveValue('Shop Thời Trang ABC');
    expect(screen.getByLabelText('Mô tả')).toHaveValue('Mô tả cũ');
    expect(screen.getByLabelText('URL logo')).toHaveValue('https://example.com/logo.png');
    expect(screen.getByLabelText('URL banner')).toHaveValue('https://example.com/banner.png');
  });

  it('shows a field error and does not submit when name is cleared', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<UpdateShopForm defaultValues={defaultValues} onSubmit={onSubmit} />));

    await user.clear(screen.getByLabelText('Tên shop'));
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    expect(await screen.findByText('Tên shop không được để trống')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with the edited values', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<UpdateShopForm defaultValues={defaultValues} onSubmit={onSubmit} />));

    await user.clear(screen.getByLabelText('Mô tả'));
    await user.type(screen.getByLabelText('Mô tả'), 'Mô tả mới');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        {
          name: 'Shop Thời Trang ABC',
          description: 'Mô tả mới',
          logoUrl: 'https://example.com/logo.png',
          bannerUrl: 'https://example.com/banner.png',
        },
        expect.anything(),
      ),
    );
  });

  it('disables submit button while isSubmitting', () => {
    render(
      withIntl(<UpdateShopForm defaultValues={defaultValues} onSubmit={vi.fn()} isSubmitting />),
    );

    expect(screen.getByRole('button', { name: 'Đang lưu...' })).toBeDisabled();
  });
});
