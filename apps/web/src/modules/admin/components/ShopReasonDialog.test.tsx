import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ShopReasonDialog, type ShopReasonDialogKind } from './ShopReasonDialog';

function setup({
  kind = 'reject' as ShopReasonDialogKind,
  open = true,
  isPending = false,
  shopName = 'Shop A',
} = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    withIntl(
      <ShopReasonDialog
        open={open}
        onOpenChange={onOpenChange}
        kind={kind}
        shopName={shopName}
        isPending={isPending}
        onConfirm={onConfirm}
      />,
    ),
  );
  return { ...utils, onConfirm, onOpenChange };
}

describe('ShopReasonDialog', () => {
  it('đóng -> không render nội dung', () => {
    setup({ open: false });

    expect(screen.queryByText('Từ chối shop này?')).not.toBeInTheDocument();
  });

  describe('từ chối', () => {
    it('nêu tên shop và hậu quả: không bán được, chủ shop thấy lý do', () => {
      setup({ kind: 'reject', shopName: 'Shop Thời Trang ABC' });

      expect(screen.getByText('Từ chối shop này?')).toBeInTheDocument();
      expect(screen.getByText(/“Shop Thời Trang ABC” sẽ không được bán hàng/)).toBeInTheDocument();
      expect(screen.getByText(/Chủ shop sẽ thấy lý do/)).toBeInTheDocument();
      expect(screen.getByLabelText('Lý do từ chối')).toBeInTheDocument();
    });
  });

  describe('khoá', () => {
    it('nêu hậu quả đúng chính sách đã chốt: sản phẩm biến khỏi sàn, không nhận đơn mới, chủ shop vẫn xử lý đơn đã có, mở khoá được', () => {
      setup({ kind: 'suspend', shopName: 'Shop Thời Trang ABC' });

      expect(screen.getByText('Khoá shop này?')).toBeInTheDocument();
      expect(
        screen.getByText(/Sản phẩm của “Shop Thời Trang ABC” sẽ biến khỏi sàn/),
      ).toBeInTheDocument();
      expect(screen.getByText(/không nhận được đơn mới/)).toBeInTheDocument();
      expect(screen.getByText(/xử lý được các đơn đã có/)).toBeInTheDocument();
      expect(screen.getByText(/mở khoá bất cứ lúc nào/)).toBeInTheDocument();
      expect(screen.getByLabelText('Lý do khoá')).toBeInTheDocument();
    });
  });

  it.each([
    ['reject', 'Từ chối shop', 'Lý do từ chối'],
    ['suspend', 'Khoá shop', 'Lý do khoá'],
  ] as const)(
    '%s: lý do BẮT BUỘC — để trống -> lỗi đã dịch theo field, KHÔNG gọi onConfirm',
    async (kind, confirmLabel, fieldLabel) => {
      const user = userEvent.setup();
      const { onConfirm } = setup({ kind });

      await user.click(screen.getByRole('button', { name: confirmLabel }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập lý do');
      expect(screen.getByLabelText(fieldLabel)).toHaveAttribute('aria-invalid', 'true');
      expect(onConfirm).not.toHaveBeenCalled();
    },
  );

  it('chỉ nhập khoảng trắng cũng coi là chưa nhập lý do', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(screen.getByLabelText('Lý do từ chối'), '    ');
    await user.click(screen.getByRole('button', { name: 'Từ chối shop' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập lý do');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it.each([
    ['reject', 'Từ chối shop', 'Lý do từ chối'],
    ['suspend', 'Khoá shop', 'Lý do khoá'],
  ] as const)(
    '%s: nhập lý do -> onConfirm nhận đúng lý do đã trim',
    async (kind, confirmLabel, fieldLabel) => {
      const user = userEvent.setup();
      const { onConfirm } = setup({ kind });

      await user.type(screen.getByLabelText(fieldLabel), '  Hàng cấm  ');
      await user.click(screen.getByRole('button', { name: confirmLabel }));

      await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
      expect(onConfirm).toHaveBeenCalledWith('Hàng cấm');
    },
  );

  it('lý do quá 500 ký tự -> lỗi đã dịch và KHÔNG gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.click(screen.getByLabelText('Lý do từ chối'));
    await user.paste('a'.repeat(501));
    await user.click(screen.getByRole('button', { name: 'Từ chối shop' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lý do tối đa 500 ký tự');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('tên shop chứa HTML hiện nguyên dạng text, không chèn thẻ vào hộp thoại', () => {
    setup({ shopName: '<img src=x onerror=alert(1)>' });

    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
  });

  it('đang gửi (isPending) -> khoá nút xác nhận lẫn nút quay lại, không gửi trùng', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ isPending: true });

    const confirm = screen.getByRole('button', { name: 'Từ chối shop' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
    await user.click(confirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it.each(['reject', 'suspend'] as const)(
    '%s: hộp thoại khai cột lưới tường minh (grid-cols-1) — lý do dài không dấu cách không làm hộp thoại rộng ra ngoài màn hình',
    (kind) => {
      setup({ kind });

      // jsdom không có layout nên không đo được độ rộng; giữ lớp này để không ai vô tình bỏ đi. Đã đo bằng trình
      // duyệt thật: thiếu lớp này nội dung hộp thoại rộng ~4257px ở 390px với 500 ký tự liền (lỗi có từ Tuần 8).
      expect(screen.getByRole('alertdialog')).toHaveClass('grid-cols-1');
    },
  );

  it('"Quay lại" đóng hộp thoại mà không thực hiện gì', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup();

    await user.click(screen.getByRole('button', { name: 'Quay lại' }));

    expect(onOpenChange.mock.calls[0][0]).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
