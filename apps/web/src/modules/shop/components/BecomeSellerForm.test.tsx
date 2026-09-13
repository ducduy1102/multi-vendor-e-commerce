import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { BecomeSellerForm } from './BecomeSellerForm';

describe('BecomeSellerForm', () => {
  it('shows a field error and does not submit when name is empty', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<BecomeSellerForm onSubmit={onSubmit} />));

    await user.click(screen.getByRole('button', { name: 'Tạo shop' }));

    expect(await screen.findByText('Tên shop không được để trống')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows an error when logoUrl is not a valid URL', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<BecomeSellerForm onSubmit={onSubmit} />));

    await user.type(screen.getByLabelText('Tên shop'), 'Shop Thời Trang ABC');
    await user.type(screen.getByLabelText('URL logo'), 'not-a-url');
    await user.click(screen.getByRole('button', { name: 'Tạo shop' }));

    expect(await screen.findByText('URL logo không hợp lệ')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Regression: input rỗng gửi "" (không phải undefined) — trước khi sửa
  // packages/types/src/shop.ts, "" bị z.string().url() từ chối dù field
  // optional, khiến submit thất bại ngay cả khi không có gì sai.
  it('calls onSubmit when optional fields (description/logoUrl/bannerUrl) are left blank', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<BecomeSellerForm onSubmit={onSubmit} />));

    await user.type(screen.getByLabelText('Tên shop'), 'Shop Thời Trang ABC');
    await user.click(screen.getByRole('button', { name: 'Tạo shop' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ name: 'Shop Thời Trang ABC' }, expect.anything()),
    );
  });

  it('calls onSubmit with all validated values when form is filled correctly', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<BecomeSellerForm onSubmit={onSubmit} />));

    await user.type(screen.getByLabelText('Tên shop'), 'Shop Thời Trang ABC');
    await user.type(screen.getByLabelText('Mô tả'), 'Chuyên đồ thời trang');
    await user.type(screen.getByLabelText('URL logo'), 'https://example.com/logo.png');
    await user.type(screen.getByLabelText('URL banner'), 'https://example.com/banner.png');
    await user.click(screen.getByRole('button', { name: 'Tạo shop' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        {
          name: 'Shop Thời Trang ABC',
          description: 'Chuyên đồ thời trang',
          logoUrl: 'https://example.com/logo.png',
          bannerUrl: 'https://example.com/banner.png',
        },
        expect.anything(),
      ),
    );
  });

  it('disables submit button while isSubmitting', () => {
    render(withIntl(<BecomeSellerForm onSubmit={vi.fn()} isSubmitting />));

    expect(screen.getByRole('button', { name: 'Đang tạo shop...' })).toBeDisabled();
  });
});
