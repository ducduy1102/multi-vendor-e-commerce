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

  describe('read-only (shop PENDING/SUSPENDED)', () => {
    it('disables every field, keeps showing the current values and has NO submit button', () => {
      render(
        withIntl(<UpdateShopForm defaultValues={defaultValues} onSubmit={vi.fn()} isReadOnly />),
      );

      for (const label of ['Tên shop', 'Mô tả', 'URL logo', 'URL banner']) {
        expect(screen.getByLabelText(label)).toBeDisabled();
      }
      expect(screen.getByLabelText('Tên shop')).toHaveValue('Shop Thời Trang ABC');
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('points every field at the explanation (aria-describedby) so screen readers hear why it is locked', () => {
      render(
        withIntl(
          <>
            <p id="lock-hint">Vì sao khoá</p>
            <UpdateShopForm
              defaultValues={defaultValues}
              onSubmit={vi.fn()}
              isReadOnly
              readOnlyHintId="lock-hint"
            />
          </>,
        ),
      );

      for (const label of ['Tên shop', 'Mô tả', 'URL logo', 'URL banner']) {
        expect(screen.getByLabelText(label)).toHaveAccessibleDescription('Vì sao khoá');
      }
    });

    it('editable form has no aria-describedby pointing at a hint that does not exist', () => {
      render(
        withIntl(
          <UpdateShopForm
            defaultValues={defaultValues}
            onSubmit={vi.fn()}
            readOnlyHintId="lock-hint"
          />,
        ),
      );

      expect(screen.getByLabelText('Tên shop')).not.toHaveAttribute('aria-describedby');
      expect(screen.getByLabelText('Tên shop')).toBeEnabled();
    });
  });

  describe('submitVariant="resubmit" (shop REJECTED)', () => {
    it('the only primary button is "Lưu và gửi duyệt lại" — no separate save-draft button', () => {
      render(
        withIntl(
          <UpdateShopForm
            defaultValues={defaultValues}
            onSubmit={vi.fn()}
            submitVariant="resubmit"
          />,
        ),
      );

      expect(screen.getAllByRole('button')).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Lưu và gửi duyệt lại' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Lưu thay đổi' })).not.toBeInTheDocument();
    });

    it('submits the edited values through onSubmit (container decides to call resubmit)', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(
        withIntl(
          <UpdateShopForm
            defaultValues={defaultValues}
            onSubmit={onSubmit}
            submitVariant="resubmit"
          />,
        ),
      );

      await user.clear(screen.getByLabelText('Mô tả'));
      await user.type(screen.getByLabelText('Mô tả'), 'Đã bổ sung giấy phép');
      await user.click(screen.getByRole('button', { name: 'Lưu và gửi duyệt lại' }));

      await waitFor(() =>
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ description: 'Đã bổ sung giấy phép' }),
          expect.anything(),
        ),
      );
    });

    it('still validates before resubmitting (cleared name blocks the request)', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(
        withIntl(
          <UpdateShopForm
            defaultValues={defaultValues}
            onSubmit={onSubmit}
            submitVariant="resubmit"
          />,
        ),
      );

      await user.clear(screen.getByLabelText('Tên shop'));
      await user.click(screen.getByRole('button', { name: 'Lưu và gửi duyệt lại' }));

      expect(await screen.findByText('Tên shop không được để trống')).toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('shows "Đang gửi..." and disables the button while submitting', () => {
      render(
        withIntl(
          <UpdateShopForm
            defaultValues={defaultValues}
            onSubmit={vi.fn()}
            submitVariant="resubmit"
            isSubmitting
          />,
        ),
      );

      expect(screen.getByRole('button', { name: 'Đang gửi...' })).toBeDisabled();
    });
  });
});
