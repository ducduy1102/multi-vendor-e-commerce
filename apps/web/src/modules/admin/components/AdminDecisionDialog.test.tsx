import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { RefundRequestKind } from '../types';
import { AdminDecisionDialog, type AdminDecisionVariant } from './AdminDecisionDialog';

function setup({
  variant,
  kind = 'CANCEL',
  open = true,
  isPending = false,
}: {
  variant: AdminDecisionVariant;
  kind?: RefundRequestKind;
  open?: boolean;
  isPending?: boolean;
}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    withIntl(
      <AdminDecisionDialog
        open={open}
        onOpenChange={onOpenChange}
        variant={variant}
        kind={kind}
        isPending={isPending}
        onConfirm={onConfirm}
      />,
    ),
  );
  return { ...utils, onConfirm, onOpenChange };
}

describe('AdminDecisionDialog — duyệt', () => {
  it('đóng -> không render nội dung', () => {
    setup({ variant: 'approve', open: false });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('yêu cầu HỦY: nói rõ đơn bị hủy, hàng về kho, tiền hoàn, người mua và shop đọc được ghi chú, không khôi phục', () => {
    setup({ variant: 'approve', kind: 'CANCEL' });

    expect(screen.getByText('Chấp thuận yêu cầu hủy đơn?')).toBeInTheDocument();
    expect(screen.getByText(/trả lại kho/)).toBeInTheDocument();
    expect(screen.getByText(/hoàn về phương thức ban đầu/)).toBeInTheDocument();
    expect(screen.getByText(/Người mua và shop đều đọc được ghi chú/)).toBeInTheDocument();
    expect(screen.getByText(/Không thể khôi phục/)).toBeInTheDocument();
    expect(screen.queryByText(/KHÔNG tự động/)).not.toBeInTheDocument();
  });

  it('yêu cầu TRẢ HÀNG: NHẮC hàng trả về KHÔNG tự cộng vào kho của shop, COD thì shop tự hoàn tiền', () => {
    setup({ variant: 'approve', kind: 'RETURN' });

    expect(screen.getByText('Chấp thuận yêu cầu trả hàng/hoàn tiền?')).toBeInTheDocument();
    expect(screen.getByText(/KHÔNG tự động được cộng lại vào kho của shop/)).toBeInTheDocument();
    expect(screen.getByText(/đơn COD/)).toBeInTheDocument();
    expect(screen.queryByText(/được trả lại kho/)).not.toBeInTheDocument();
  });

  it('ghi chú của duyệt là TUỲ CHỌN: để trống vẫn gửi được, onConfirm nhận undefined', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ variant: 'approve' });

    await user.click(screen.getByRole('button', { name: 'Chấp thuận' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('có ghi chú -> onConfirm nhận ghi chú đã trim', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ variant: 'approve' });

    await user.type(screen.getByLabelText('Ghi chú (không bắt buộc)'), '  Đã kiểm tra  ');
    await user.click(screen.getByRole('button', { name: 'Chấp thuận' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Đã kiểm tra'));
  });

  it('ghi chú quá 500 ký tự -> lỗi đã dịch và KHÔNG gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ variant: 'approve' });

    await user.click(screen.getByLabelText('Ghi chú (không bắt buộc)'));
    await user.paste('a'.repeat(501));
    await user.click(screen.getByRole('button', { name: 'Chấp thuận' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lý do tối đa 500 ký tự');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('nút xác nhận của duyệt là nút chính (primary), không đỏ', () => {
    setup({ variant: 'approve' });

    const confirm = screen.getByRole('button', { name: 'Chấp thuận' });
    expect(confirm).toHaveClass('bg-primary');
    expect(confirm).not.toHaveClass('bg-destructive/10');
  });
});

describe('AdminDecisionDialog — từ chối', () => {
  it('tiêu đề, mô tả (đơn giữ nguyên, hai bên đọc được lý do), nhãn "Lý do từ chối" và nút đỏ', () => {
    setup({ variant: 'reject' });

    expect(screen.getByText('Từ chối yêu cầu này?')).toBeInTheDocument();
    expect(screen.getByText(/Đơn giữ nguyên/)).toBeInTheDocument();
    expect(screen.getByLabelText('Lý do từ chối')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Từ chối yêu cầu' })).toHaveClass(
      'bg-destructive/10',
    );
  });

  it('lý do BẮT BUỘC: để trống -> lỗi theo field + aria-invalid, KHÔNG gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ variant: 'reject' });

    await user.click(screen.getByRole('button', { name: 'Từ chối yêu cầu' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập lý do');
    expect(screen.getByLabelText('Lý do từ chối')).toHaveAttribute('aria-invalid', 'true');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('chỉ nhập khoảng trắng cũng coi là chưa nhập lý do', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ variant: 'reject' });

    await user.type(screen.getByLabelText('Lý do từ chối'), '    ');
    await user.click(screen.getByRole('button', { name: 'Từ chối yêu cầu' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập lý do');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('nhập lý do -> onConfirm nhận đúng lý do đã trim', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ variant: 'reject' });

    await user.type(screen.getByLabelText('Lý do từ chối'), '  Thiếu bằng chứng  ');
    await user.click(screen.getByRole('button', { name: 'Từ chối yêu cầu' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Thiếu bằng chứng'));
  });

  it('lý do 501 ký tự -> lỗi và KHÔNG gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ variant: 'reject' });

    await user.click(screen.getByLabelText('Lý do từ chối'));
    await user.paste('a'.repeat(501));
    await user.click(screen.getByRole('button', { name: 'Từ chối yêu cầu' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lý do tối đa 500 ký tự');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('lý do từ chối không phụ thuộc loại yêu cầu: mô tả giống nhau cho hủy và trả hàng', () => {
    const { unmount } = setup({ variant: 'reject', kind: 'CANCEL' });
    const cancelText = screen.getByText(/Đơn giữ nguyên/).textContent;
    unmount();

    setup({ variant: 'reject', kind: 'RETURN' });
    expect(screen.getByText(/Đơn giữ nguyên/).textContent).toBe(cancelText);
  });
});

describe.each<AdminDecisionVariant>(['approve', 'reject'])(
  'AdminDecisionDialog — chung (%s)',
  (variant) => {
    const confirmName = variant === 'approve' ? 'Chấp thuận' : 'Từ chối yêu cầu';

    it('đang gửi (isPending) -> khoá nút xác nhận lẫn "Quay lại", không gửi trùng', async () => {
      const user = userEvent.setup();
      const { onConfirm } = setup({ variant, isPending: true });

      const confirm = screen.getByRole('button', { name: confirmName });
      expect(confirm).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
      await user.click(confirm);

      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('"Quay lại" đóng hộp thoại mà không xác nhận', async () => {
      const user = userEvent.setup();
      const { onConfirm, onOpenChange } = setup({ variant });

      await user.click(screen.getByRole('button', { name: 'Quay lại' }));

      expect(onOpenChange.mock.calls[0][0]).toBe(false);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('hộp thoại khai cột lưới tường minh (grid-cols-1): ghi chú dài không dấu cách không làm hộp thoại rộng ra ngoài màn hình', () => {
      setup({ variant });

      // jsdom không có layout nên không đo được độ rộng; giữ lớp này để không ai vô tình bỏ đi (đã đo bằng trình
      // duyệt thật ở 390px với 500 ký tự liền).
      expect(screen.getByRole('alertdialog')).toHaveClass('grid-cols-1');
    });
  },
);
