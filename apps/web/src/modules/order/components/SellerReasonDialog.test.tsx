import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { SellerReasonDialog, type SellerReasonDialogVariant } from './SellerReasonDialog';

function setup({
  variant,
  open = true,
  isPending = false,
}: {
  variant: SellerReasonDialogVariant;
  open?: boolean;
  isPending?: boolean;
}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    withIntl(
      <SellerReasonDialog
        variant={variant}
        open={open}
        onOpenChange={onOpenChange}
        isPending={isPending}
        onConfirm={onConfirm}
      />,
    ),
  );
  return { ...utils, onConfirm, onOpenChange };
}

// Mỗi biến thể: chữ riêng của nó (tiêu đề, nhãn ô nhập, nút) — phần hành vi chung (bắt buộc lý do, 500 ký tự,
// khoá khi đang gửi) kiểm đủ cho từng biến thể ở dưới để một biến thể không lệch khỏi hai biến thể kia.
const VARIANTS = [
  {
    variant: 'rejectOrder',
    title: 'Từ chối đơn hàng này?',
    label: 'Lý do từ chối',
    confirm: 'Từ chối đơn',
    keep: 'Giữ đơn hàng',
  },
  {
    variant: 'cancelOrder',
    title: 'Hủy đơn hàng này?',
    label: 'Lý do hủy đơn',
    confirm: 'Hủy đơn',
    keep: 'Giữ đơn hàng',
  },
  {
    variant: 'rejectRefund',
    title: 'Từ chối yêu cầu này?',
    label: 'Lý do từ chối',
    confirm: 'Từ chối yêu cầu',
    keep: 'Quay lại',
  },
] as const;

describe.each(VARIANTS)(
  'SellerReasonDialog — $variant',
  ({ variant, title, label, confirm, keep }) => {
    it('đóng -> không render nội dung', () => {
      setup({ variant, open: false });

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('mở -> đúng tiêu đề, nhãn ô nhập và nút của biến thể', () => {
      setup({ variant });

      expect(screen.getByText(title)).toBeInTheDocument();
      expect(screen.getByLabelText(label)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: confirm })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: keep })).toBeInTheDocument();
    });

    it('nút xác nhận là nút đỏ (destructive) — chỗ duy nhất dùng màu đỏ cho hành động không hoàn tác', () => {
      setup({ variant });

      expect(screen.getByRole('button', { name: confirm })).toHaveClass('bg-destructive/10');
    });

    it('lý do BẮT BUỘC: để trống -> lỗi đã dịch theo field, KHÔNG gọi onConfirm', async () => {
      const user = userEvent.setup();
      const { onConfirm } = setup({ variant });

      await user.click(screen.getByRole('button', { name: confirm }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập lý do');
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('chỉ nhập khoảng trắng cũng coi là chưa nhập lý do', async () => {
      const user = userEvent.setup();
      const { onConfirm } = setup({ variant });

      await user.type(screen.getByLabelText(label), '    ');
      await user.click(screen.getByRole('button', { name: confirm }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập lý do');
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('nhập lý do -> onConfirm nhận đúng lý do đã trim', async () => {
      const user = userEvent.setup();
      const { onConfirm } = setup({ variant });

      await user.type(screen.getByLabelText(label), '  Hết hàng  ');
      await user.click(screen.getByRole('button', { name: confirm }));

      await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
      expect(onConfirm).toHaveBeenCalledWith('Hết hàng');
    });

    it('đúng 500 ký tự gửi được; 501 ký tự -> lỗi đã dịch và KHÔNG gọi onConfirm', async () => {
      const user = userEvent.setup();
      const { onConfirm } = setup({ variant });

      await user.click(screen.getByLabelText(label));
      await user.paste('a'.repeat(501));
      await user.click(screen.getByRole('button', { name: confirm }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Lý do tối đa 500 ký tự');
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('đang gửi (isPending) -> khoá nút xác nhận lẫn nút giữ lại, không gửi trùng', async () => {
      const user = userEvent.setup();
      const { onConfirm } = setup({ variant, isPending: true });

      const confirmButton = screen.getByRole('button', { name: confirm });
      expect(confirmButton).toBeDisabled();
      expect(screen.getByRole('button', { name: keep })).toBeDisabled();
      await user.click(confirmButton);

      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('nút giữ lại đóng hộp thoại mà không xác nhận', async () => {
      const user = userEvent.setup();
      const { onConfirm, onOpenChange } = setup({ variant });

      await user.click(screen.getByRole('button', { name: keep }));

      expect(onOpenChange.mock.calls[0][0]).toBe(false);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('hộp thoại khai cột lưới tường minh (grid-cols-1): lý do dài không dấu cách không làm hộp thoại rộng ra ngoài màn hình', () => {
      setup({ variant });

      // jsdom không có layout nên không đo được độ rộng; giữ lớp này để không ai vô tình bỏ đi. Cột ngầm định
      // `auto` của AlertDialogContent lấy min-content của ô nhập `field-sizing: content` (đã gặp: ~4385px ở 390px,
      // kiểm bằng Playwright ở 3.5/3.6).
      expect(screen.getByRole('alertdialog')).toHaveClass('grid-cols-1');
    });
  },
);

describe('SellerReasonDialog — chữ giải thích hậu quả từng biến thể', () => {
  it('từ chối đơn: đơn bị hủy, hàng trả lại kho, người mua thấy lý do, không khôi phục được', () => {
    setup({ variant: 'rejectOrder' });

    expect(screen.getByText(/trả lại kho/)).toBeInTheDocument();
    expect(screen.getByText(/Người mua sẽ thấy lý do/)).toBeInTheDocument();
    expect(screen.getByText(/Không thể khôi phục/)).toBeInTheDocument();
  });

  it('hủy đơn: nói rõ tiền (nếu đã thanh toán) được hoàn về phương thức ban đầu', () => {
    setup({ variant: 'cancelOrder' });

    expect(screen.getByText(/trả lại kho/)).toBeInTheDocument();
    expect(screen.getByText(/hoàn về phương thức ban đầu/)).toBeInTheDocument();
    expect(screen.getByText(/Không thể khôi phục/)).toBeInTheDocument();
  });

  it('từ chối yêu cầu: đơn giữ nguyên, người mua thấy lý do và khiếu nại được lên sàn', () => {
    setup({ variant: 'rejectRefund' });

    expect(screen.getByText(/Đơn giữ nguyên/)).toBeInTheDocument();
    expect(screen.getByText(/khiếu nại lên sàn/)).toBeInTheDocument();
  });
});

describe('SellerReasonDialog — nhãn ô nhập duy nhất mỗi biến thể', () => {
  it('ba biến thể dùng id ô nhập khác nhau (không đụng id nếu có hai hộp thoại cùng mount)', () => {
    const ids = VARIANTS.map(({ variant, label }) => {
      const { unmount } = setup({ variant });
      const id = screen.getByLabelText(label).id;
      unmount();
      return id;
    });

    expect(new Set(ids).size).toBe(3);
  });
});
