import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { AdminUserAction } from '../admin-user-actions';
import { ADMIN_USER_REASON_MAX_LENGTH } from '../schemas/admin.schema';
import { AdminUserReasonDialog } from './AdminUserReasonDialog';

const USER = {
  id: 'u-1',
  name: 'Nguyễn Văn An',
  email: 'an.nguyen@example.com',
  statusReason: null as string | null,
};

function setup({
  action = 'suspend' as AdminUserAction,
  open = true,
  isPending = false,
  error = null as string | null,
  user = USER,
} = {}) {
  const onConfirm = vi.fn<(reason: string) => void>();
  const onOpenChange = vi.fn();
  const utils = render(
    withIntl(
      <AdminUserReasonDialog
        open={open}
        onOpenChange={onOpenChange}
        action={action}
        user={user}
        isPending={isPending}
        error={error}
        onConfirm={onConfirm}
      />,
    ),
  );
  return { ...utils, onConfirm, onOpenChange };
}

const consequences = () => screen.getByRole('list', { name: 'Hệ quả' });

describe('AdminUserReasonDialog', () => {
  it('đóng -> không render nội dung', () => {
    setup({ open: false });

    expect(screen.queryByText('Tạm khoá tài khoản?')).not.toBeInTheDocument();
  });

  describe('nội dung theo hành động', () => {
    it('tạm khoá: nêu người bị khoá, đăng xuất ngay, shop tạm ngừng "nếu có" (câu chung, không tải thêm chi tiết), email kèm lý do', () => {
      setup({ action: 'suspend' });

      expect(screen.getByRole('alertdialog', { name: 'Tạm khoá tài khoản?' })).toBeInTheDocument();
      expect(screen.getByText('Nguyễn Văn An (an.nguyen@example.com)')).toBeInTheDocument();
      expect(consequences()).toHaveTextContent('Đăng xuất ngay khỏi mọi thiết bị');
      expect(consequences()).toHaveTextContent('Các shop thuộc tài khoản sẽ tạm ngừng nếu có.');
      expect(consequences()).toHaveTextContent('Gửi email kèm lý do tới an.nguyen@example.com.');
      expect(screen.getByRole('button', { name: 'Tạm khoá' })).toBeInTheDocument();
    });

    it('cấm: nói rõ shop KHÔNG tự mở lại khi gỡ cấm', () => {
      setup({ action: 'ban' });

      expect(screen.getByRole('alertdialog', { name: 'Cấm tài khoản?' })).toBeInTheDocument();
      expect(consequences()).toHaveTextContent('Đăng xuất ngay khỏi mọi thiết bị');
      expect(consequences()).toHaveTextContent('không tự mở lại khi gỡ cấm');
      expect(screen.getByRole('button', { name: 'Cấm tài khoản' })).toBeInTheDocument();
    });

    it('mở lại (từ tạm khoá): đăng nhập lại được ngay, shop của chính lần khoá này tự mở lại', () => {
      setup({ action: 'reactivate' });

      expect(screen.getByRole('alertdialog', { name: 'Mở lại tài khoản?' })).toBeInTheDocument();
      expect(consequences()).toHaveTextContent('Đăng nhập lại được ngay.');
      expect(consequences()).toHaveTextContent('sẽ tự mở lại');
      expect(consequences()).not.toHaveTextContent('Đăng xuất ngay');
      expect(screen.getByRole('button', { name: 'Mở lại' })).toBeInTheDocument();
    });

    it('gỡ cấm: yêu cầu xét lại, nói rõ shop KHÔNG tự mở lại và hiện lý do cấm hiện tại để Admin đối chiếu', () => {
      setup({ action: 'unban', user: { ...USER, statusReason: 'Bán hàng giả' } });

      expect(screen.getByRole('alertdialog', { name: 'Gỡ cấm tài khoản?' })).toBeInTheDocument();
      expect(screen.getByText(/đã xét lại lý do cấm/)).toBeInTheDocument();
      expect(consequences()).toHaveTextContent('Đăng nhập lại được ngay.');
      expect(consequences()).toHaveTextContent('Các shop của tài khoản không tự mở lại');
      expect(consequences()).toHaveTextContent('Tài khoản này đang bị cấm: Bán hàng giả');
      expect(screen.getByRole('button', { name: 'Gỡ cấm' })).toBeInTheDocument();
    });

    it('gỡ cấm mà không có lý do cấm cũ (dữ liệu cũ) -> không hiện dòng cảnh báo rỗng', () => {
      setup({ action: 'unban' });

      expect(consequences()).not.toHaveTextContent('đang bị cấm');
    });
  });

  it('hộp thoại giới hạn theo chiều cao khung nhìn và tự cuộn (màn thấp không làm nút xác nhận rơi ra ngoài)', () => {
    setup();

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveClass('overflow-y-auto');
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]');
  });

  describe('lý do bắt buộc', () => {
    it.each<AdminUserAction>(['suspend', 'ban', 'reactivate', 'unban'])(
      '%s: bỏ trống -> báo lỗi theo field, KHÔNG gọi onConfirm',
      async (action) => {
        const user = userEvent.setup();
        const { onConfirm } = setup({ action });

        await user.click(
          screen.getByRole('button', { name: /Tạm khoá|Cấm tài khoản|Mở lại|Gỡ cấm/ }),
        );

        expect(await screen.findByText('Vui lòng nhập lý do')).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: /Lý do/ })).toHaveAttribute(
          'aria-invalid',
          'true',
        );
        expect(onConfirm).not.toHaveBeenCalled();
      },
    );

    it('toàn khoảng trắng coi như chưa nhập', async () => {
      const user = userEvent.setup();
      const { onConfirm } = setup();

      await user.type(screen.getByRole('textbox', { name: /Lý do/ }), '   ');
      await user.click(screen.getByRole('button', { name: 'Tạm khoá' }));

      expect(await screen.findByText('Vui lòng nhập lý do')).toBeInTheDocument();
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('lý do quá dài -> báo lỗi, không gửi; bộ đếm chuyển sang cảnh báo', async () => {
      const user = userEvent.setup();
      const { onConfirm } = setup();
      const tooLong = 'a'.repeat(ADMIN_USER_REASON_MAX_LENGTH + 1);

      await user.click(screen.getByRole('textbox', { name: /Lý do/ }));
      await user.paste(tooLong);
      await user.click(screen.getByRole('button', { name: 'Tạm khoá' }));

      expect(await screen.findByText('Lý do tối đa 500 ký tự')).toBeInTheDocument();
      expect(screen.getByText(`${tooLong.length}/500`)).toHaveClass('text-destructive');
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('lý do hợp lệ -> onConfirm nhận đúng lý do đã chuẩn hoá (cắt khoảng trắng hai đầu)', async () => {
      const user = userEvent.setup();
      const { onConfirm } = setup();

      await user.type(screen.getByRole('textbox', { name: /Lý do/ }), '  Vi phạm điều khoản  ');
      await user.click(screen.getByRole('button', { name: 'Tạm khoá' }));

      await waitFor(() => expect(onConfirm).toHaveBeenCalledExactlyOnceWith('Vi phạm điều khoản'));
    });

    it('bộ đếm ký tự cập nhật theo lúc gõ', async () => {
      const user = userEvent.setup();
      setup();

      expect(screen.getByText('0/500')).toBeInTheDocument();
      await user.type(screen.getByRole('textbox', { name: /Lý do/ }), 'abc');
      expect(screen.getByText('3/500')).toBeInTheDocument();
    });
  });

  describe('đang gửi và lỗi', () => {
    it('đang gửi -> khoá ô nhập, nút Quay lại và nút xác nhận (đổi chữ "Đang xử lý…"), tránh gửi trùng', () => {
      setup({ isPending: true });

      expect(screen.getByRole('textbox', { name: /Lý do/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
      const confirm = screen.getByRole('button', { name: 'Đang xử lý…' });
      expect(confirm).toBeDisabled();
      expect(confirm).toHaveAttribute('aria-busy', 'true');
    });

    it('lỗi từ máy chủ hiện NGAY TRONG hộp thoại, giữ nguyên lý do đã gõ để Admin không phải gõ lại', async () => {
      const user = userEvent.setup();
      const { rerender, onConfirm } = setup();
      await user.type(screen.getByRole('textbox', { name: /Lý do/ }), 'Lý do dài đã gõ');

      rerender(
        withIntl(
          <AdminUserReasonDialog
            open
            onOpenChange={vi.fn()}
            action="suspend"
            user={USER}
            isPending={false}
            error="Trạng thái tài khoản vừa thay đổi."
            onConfirm={onConfirm}
          />,
        ),
      );

      expect(screen.getByRole('alert')).toHaveTextContent('Trạng thái tài khoản vừa thay đổi.');
      expect(screen.getByRole('textbox', { name: /Lý do/ })).toHaveValue('Lý do dài đã gõ');
    });

    it('không có lỗi -> không có vùng cảnh báo máy chủ', () => {
      setup({ error: null });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('văn bản người dùng nhập (tên, email, lý do cấm cũ) chỉ hiện dạng text, không thành HTML', () => {
    setup({
      action: 'unban',
      user: {
        id: 'u-2',
        name: '<img src=x onerror=alert(1)>',
        email: 'x@example.com',
        statusReason: '<script>alert(1)</script>',
      },
    });

    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });

  it('bản tiếng Anh: không lộ chuỗi tiếng Việt', () => {
    render(
      withIntl(
        <AdminUserReasonDialog
          open
          onOpenChange={vi.fn()}
          action="ban"
          user={USER}
          isPending={false}
          error={null}
          onConfirm={vi.fn()}
        />,
        'en',
      ),
    );

    expect(screen.getByRole('alertdialog', { name: 'Ban this account?' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Consequences' })).toHaveTextContent(
      'Signed out of every device immediately',
    );
    expect(screen.queryByText(/Cấm|Đăng xuất|tài khoản/)).not.toBeInTheDocument();
  });
});
