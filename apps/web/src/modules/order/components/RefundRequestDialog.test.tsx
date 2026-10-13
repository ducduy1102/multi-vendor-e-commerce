import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { RefundRequestKind } from '../types';
import { RefundRequestDialog } from './RefundRequestDialog';

function setup({
  kind = 'CANCEL',
  open = true,
  isPending = false,
}: { kind?: RefundRequestKind; open?: boolean; isPending?: boolean } = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    withIntl(
      <RefundRequestDialog
        open={open}
        onOpenChange={onOpenChange}
        kind={kind}
        isPending={isPending}
        onConfirm={onConfirm}
      />,
    ),
  );
  return { ...utils, onConfirm, onOpenChange };
}

const reasonSelect = () => screen.getByRole('combobox', { name: 'Lý do' });
const noteBox = () => screen.getByRole('textbox', { name: 'Mô tả chi tiết' });
const submit = () => screen.getByRole('button', { name: 'Gửi yêu cầu' });
const optionLabels = () =>
  within(reasonSelect())
    .getAllByRole('option')
    .map((o) => o.textContent);

describe('RefundRequestDialog', () => {
  it('đóng -> không render nội dung', () => {
    setup({ open: false });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('yêu cầu HỦY: tiêu đề + mô tả theo loại, chỉ có các lý do của việc hủy (kèm "Lý do khác")', () => {
    setup({ kind: 'CANCEL' });

    expect(screen.getByText('Yêu cầu hủy đơn hàng')).toBeInTheDocument();
    expect(screen.getByText(/được hủy tự động/)).toBeInTheDocument();
    expect(optionLabels()).toEqual([
      'Chọn lý do',
      'Đổi ý, không muốn mua nữa',
      'Sai thông tin đặt hàng (địa chỉ, số điện thoại...)',
      'Tìm được nơi bán rẻ hơn',
      'Giao hàng quá lâu',
      'Lý do khác',
    ]);
  });

  it('yêu cầu TRẢ HÀNG: tiêu đề + mô tả theo loại, chỉ có các lý do của việc trả hàng', () => {
    setup({ kind: 'RETURN' });

    expect(screen.getByText('Yêu cầu trả hàng/hoàn tiền')).toBeInTheDocument();
    expect(screen.getByText(/khiếu nại lên sàn/)).toBeInTheDocument();
    expect(optionLabels()).toEqual([
      'Chọn lý do',
      'Hàng bị hư hỏng, vỡ',
      'Giao sai sản phẩm',
      'Không đúng mô tả',
      'Thiếu hàng',
      'Lý do khác',
    ]);
  });

  it('chưa chọn lý do mà gửi -> báo "Vui lòng chọn lý do" (thiếu), KHÔNG phải "không hợp lệ", và không gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.click(submit());

    expect(await screen.findByText('Vui lòng chọn lý do')).toBeInTheDocument();
    expect(screen.queryByText('Lý do không hợp lệ')).not.toBeInTheDocument();
    expect(reasonSelect()).toHaveAttribute('aria-invalid', 'true');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('chọn lý do, bỏ trống mô tả -> onConfirm({ reasonCode, reasonNote: undefined }) — KHÔNG gửi loại yêu cầu', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ kind: 'RETURN' });

    await user.selectOptions(reasonSelect(), 'DAMAGED');
    await user.click(submit());

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith({ reasonCode: 'DAMAGED', reasonNote: undefined });
  });

  it('có mô tả -> gửi đã trim', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.selectOptions(reasonSelect(), 'CHANGE_OF_MIND');
    await user.type(noteBox(), '  Không cần nữa  ');
    await user.click(submit());

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith({
      reasonCode: 'CHANGE_OF_MIND',
      reasonNote: 'Không cần nữa',
    });
  });

  it('chọn "Lý do khác" mà không mô tả -> lỗi gắn đúng ô mô tả, không gọi onConfirm; có mô tả thì gửi được', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.selectOptions(reasonSelect(), 'OTHER');
    await user.click(submit());

    expect(
      await screen.findByText('Vui lòng mô tả chi tiết khi chọn lý do khác'),
    ).toBeInTheDocument();
    expect(noteBox()).toHaveAttribute('aria-invalid', 'true');
    expect(onConfirm).not.toHaveBeenCalled();

    await user.type(noteBox(), 'Lý do riêng');
    await user.click(submit());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith({ reasonCode: 'OTHER', reasonNote: 'Lý do riêng' });
  });

  it('mô tả vượt 500 ký tự -> lỗi tại ô mô tả, không gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.selectOptions(reasonSelect(), 'FOUND_CHEAPER');
    await user.click(noteBox());
    await user.paste('a'.repeat(501));
    await user.click(submit());

    expect(await screen.findByText('Ghi chú tối đa 500 ký tự')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('gợi ý "Bắt buộc khi chọn Lý do khác" hiện mặc định và nhường chỗ cho thông báo lỗi', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByText(/Bắt buộc khi chọn/)).toBeInTheDocument();

    await user.selectOptions(reasonSelect(), 'OTHER');
    await user.click(submit());

    await screen.findByText('Vui lòng mô tả chi tiết khi chọn lý do khác');
    expect(screen.queryByText(/Bắt buộc khi chọn/)).not.toBeInTheDocument();
  });

  it('đang gửi: khoá ô chọn, ô mô tả, nút gửi và nút Quay lại', () => {
    setup({ isPending: true });

    expect(reasonSelect()).toBeDisabled();
    expect(noteBox()).toBeDisabled();
    expect(submit()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
  });

  it('nút Quay lại đóng hộp thoại mà không gửi', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup();

    await user.click(screen.getByRole('button', { name: 'Quay lại' }));

    expect(onOpenChange.mock.calls[0][0]).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('hộp thoại khai cột tường minh (grid-cols-1): ô mô tả 500 ký tự liền không làm nội dung tràn khỏi hộp thoại ở 390px', () => {
    setup();

    // Hồi quy từ trình duyệt thật: không có lớp này, cột ngầm định lấy min-content của textarea và nội dung rộng
    // ~4400px (jsdom không có layout nên chỉ giữ được lớp class).
    expect(screen.getByRole('alertdialog')).toHaveClass('grid-cols-1');
  });

  it('nút gửi trung tính (không phải nút đỏ phá huỷ): gửi yêu cầu để shop xem xét chưa phải hành động không hoàn tác', () => {
    setup();

    expect(submit()).toHaveClass('bg-primary');
    expect(submit()).not.toHaveClass('bg-destructive/10');
  });
});
