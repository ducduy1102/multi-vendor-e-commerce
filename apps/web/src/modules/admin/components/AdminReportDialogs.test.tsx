import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { AdminReportConfirmDialog } from './AdminReportConfirmDialog';
import { AdminReportReopenDialog } from './AdminReportReopenDialog';

afterEach(() => cleanup());

function confirmSetup(
  props: Partial<React.ComponentProps<typeof AdminReportConfirmDialog>> = {},
  locale: 'vi' | 'en' = 'vi',
) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    withIntl(
      <AdminReportConfirmDialog
        open
        onOpenChange={onOpenChange}
        input={{ action: 'HIDE_REVIEW', note: 'Ngôn từ xúc phạm người bán.' }}
        othersCount={2}
        isPending={false}
        onConfirm={onConfirm}
        {...props}
      />,
      locale,
    ),
  );
  return { onConfirm, onOpenChange };
}

describe('AdminReportConfirmDialog', () => {
  it('ẩn đánh giá: nêu hệ quả, cho đọc lại đúng ghi chú sắp gửi, nói ai sẽ đọc, và số báo cáo đóng cùng', () => {
    confirmSetup();

    const dialog = screen.getByRole('alertdialog', { name: 'Ẩn đánh giá này?' });
    expect(dialog).toHaveTextContent('Đánh giá biến khỏi trang sản phẩm');
    expect(dialog).toHaveTextContent('Ngôn từ xúc phạm người bán.');
    expect(dialog).toHaveTextContent('Ghi chú hiển thị cho tác giả và chủ shop');
    expect(dialog).toHaveTextContent('Sẽ đóng thêm 2 báo cáo về cùng đối tượng.');
  });

  it.each([
    ['SHOP', 'Khoá shop này?', 'Khoá shop'],
    ['SUSPEND_REPORTED_USER', 'Khoá tài khoản bên bị báo?', 'Khoá tài khoản'],
    ['DISMISS', 'Bỏ qua báo cáo này?', 'Bỏ qua báo cáo'],
  ])('hành động %s: tiêu đề và nút xác nhận riêng', (action, title, confirm) => {
    confirmSetup({
      input: { action: (action === 'SHOP' ? 'SUSPEND_SHOP' : action) as never, note: 'Lý do' },
    });

    expect(screen.getByRole('alertdialog', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: confirm })).toBeInTheDocument();
  });

  it('không có người khác cùng báo ⇒ "Chỉ đóng báo cáo này."', () => {
    confirmSetup({ othersCount: 0 });

    expect(screen.getByText('Chỉ đóng báo cáo này.')).toBeInTheDocument();
  });

  it('"Bỏ qua" không ghi chú ⇒ "Không có ghi chú", không có câu nói ai đọc', () => {
    confirmSetup({ input: { action: 'DISMISS', note: undefined } });

    expect(screen.getByText('Không có ghi chú')).toBeInTheDocument();
    expect(screen.queryByText(/Ghi chú hiển thị cho/)).not.toBeInTheDocument();
  });

  it('hành động huỷ bỏ: nút xác nhận là nút ĐỎ ĐẶC; "Bỏ qua": nút chính trung tính', () => {
    confirmSetup();
    expect(screen.getByRole('button', { name: 'Ẩn đánh giá' }).className).toContain(
      'bg-destructive',
    );
    expect(screen.getByRole('button', { name: 'Ẩn đánh giá' }).className).toContain(
      'text-background',
    );

    cleanup();
    confirmSetup({ input: { action: 'DISMISS', note: undefined } });
    expect(screen.getByRole('button', { name: 'Bỏ qua báo cáo' }).className).not.toContain(
      'bg-destructive',
    );
  });

  it('bấm xác nhận gọi onConfirm; "Quay lại" gọi đóng và KHÔNG xác nhận', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = confirmSetup();

    await user.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(onConfirm).not.toHaveBeenCalled();
    // Base UI gọi onOpenChange(open, chi tiết sự kiện): chỉ khẳng định đối số đầu.
    expect(onOpenChange.mock.calls[0][0]).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Ẩn đánh giá' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('đang gửi: cả hai nút bị khoá và nút xác nhận báo bận', () => {
    confirmSetup({ isPending: true });

    expect(screen.getByRole('button', { name: 'Ẩn đánh giá' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ẩn đánh giá' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
  });

  it('ghi chú là văn bản tự do: chuỗi dài không dấu cách ngắt được chữ, ký tự HTML hiện nguyên chữ', () => {
    const note = '<img src=x onerror=alert(1)>' + 'x'.repeat(400);
    confirmSetup({ input: { action: 'HIDE_REVIEW', note } });

    const el = screen.getByText(note);
    expect(el.className).toContain('[overflow-wrap:anywhere]');
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('tiếng Anh', () => {
    confirmSetup({}, 'en');

    expect(screen.getByRole('alertdialog', { name: 'Hide this review?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide review' })).toBeInTheDocument();
  });
});

function reopenSetup(props: Partial<React.ComponentProps<typeof AdminReportReopenDialog>> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    withIntl(
      <AdminReportReopenDialog
        open
        onOpenChange={onOpenChange}
        isPending={false}
        error={null}
        onConfirm={onConfirm}
        {...props}
      />,
    ),
  );
  return { onConfirm, onOpenChange };
}

describe('AdminReportReopenDialog', () => {
  it('nói rõ lý do chỉ ghi vào nhật ký, không gửi cho ai', () => {
    reopenSetup();

    expect(screen.getByRole('alertdialog', { name: 'Mở lại đánh giá này?' })).toHaveTextContent(
      'chỉ ghi vào nhật ký quản trị, không gửi cho ai',
    );
  });

  it('bỏ trống lý do ⇒ báo lỗi, KHÔNG gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = reopenSetup();

    await user.click(screen.getByRole('button', { name: 'Mở lại đánh giá' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập lý do');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('có lý do ⇒ gọi onConfirm với lý do đã cắt khoảng trắng', async () => {
    const user = userEvent.setup();
    const { onConfirm } = reopenSetup();

    await user.type(screen.getByLabelText('Lý do mở lại'), '  Đã xét lại, không vi phạm  ');
    await user.click(screen.getByRole('button', { name: 'Mở lại đánh giá' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Đã xét lại, không vi phạm'));
  });

  it('lý do quá 500 ký tự bị từ chối', async () => {
    const user = userEvent.setup();
    const { onConfirm } = reopenSetup();

    await user.click(screen.getByLabelText('Lý do mở lại'));
    await user.paste('a'.repeat(501));
    await user.click(screen.getByRole('button', { name: 'Mở lại đánh giá' }));

    expect(await screen.findByText('Lý do tối đa 500 ký tự')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('lỗi từ BE hiện ngay trong hộp thoại và lý do đã gõ được giữ nguyên', async () => {
    const user = userEvent.setup();
    reopenSetup({ error: 'Đánh giá này đang hiển thị.' });

    expect(screen.getByRole('alert')).toHaveTextContent('Đánh giá này đang hiển thị.');
    await user.type(screen.getByLabelText('Lý do mở lại'), 'abc');
    expect(screen.getByLabelText('Lý do mở lại')).toHaveValue('abc');
  });

  it('đang gửi: khoá ô nhập và nút', () => {
    reopenSetup({ isPending: true });

    expect(screen.getByLabelText('Lý do mở lại')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mở lại đánh giá' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
  });
});
