import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { CancelShopOrdersSummary } from '../admin-cancel-orders-result';
import type { CancelShopOrdersDialogState } from '../hooks/useCancelShopOrdersFlow';
import { ADMIN_USER_REASON_MAX_LENGTH } from '../schemas/admin.schema';
import { CancelShopOrdersDialog } from './CancelShopOrdersDialog';

const SHOP = { id: 'shop-1', name: 'Thời Trang Thảo' };

const summary = (overrides: Partial<CancelShopOrdersSummary> = {}): CancelShopOrdersSummary => ({
  cancelled: 0,
  failed: [],
  needsManualRefund: [],
  refundsPending: 0,
  remaining: 0,
  ...overrides,
});

function setup(overrides: Partial<CancelShopOrdersDialogState> = {}, locale: 'vi' | 'en' = 'vi') {
  const onConfirm = vi.fn<(reason: string) => void>();
  const onContinue = vi.fn();
  const onOpenChange = vi.fn();
  const props: CancelShopOrdersDialogState = {
    target: SHOP,
    isOpen: true,
    onOpenChange,
    isPending: false,
    error: null,
    summary: null,
    onConfirm,
    onContinue,
    ...overrides,
  };
  const utils = render(withIntl(<CancelShopOrdersDialog {...props} />, locale));
  return { ...utils, onConfirm, onContinue, onOpenChange };
}

const reasonBox = () => screen.getByRole('textbox', { name: /Lý do/ });
const nameBox = () => screen.getByRole('textbox', { name: 'Gõ lại tên shop để xác nhận' });
const confirmButton = () => screen.getByRole('button', { name: 'Hủy các đơn chưa giao' });

describe('CancelShopOrdersDialog — form', () => {
  it('không có shop đích -> không vẽ gì; đóng -> không render nội dung', () => {
    const none = setup({ target: null });
    expect(none.container).toBeEmptyDOMElement();
    none.unmount();

    setup({ isOpen: false });
    expect(screen.queryByText('Hủy các đơn chưa giao của shop này?')).not.toBeInTheDocument();
  });

  it('nêu tên shop, đối tượng bị hủy và đủ hậu quả: kho, voucher, hoàn tiền (có thể phải hoàn tay), email, không hoàn tác + giới hạn mỗi lần', () => {
    setup();

    expect(
      screen.getByRole('alertdialog', { name: 'Hủy các đơn chưa giao của shop này?' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/“Thời Trang Thảo” sẽ bị hủy/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Hệ quả' });
    expect(list).toHaveTextContent('cộng lại vào kho');
    expect(list).toHaveTextContent('voucher');
    expect(list).toHaveTextContent('hoàn tay');
    expect(list).toHaveTextContent('Đơn COD chưa thu tiền nên không có khoản hoàn');
    expect(list).toHaveTextContent('email báo đơn bị hủy kèm lý do');
    expect(list).toHaveTextContent('Không hoàn tác được');
    expect(list).toHaveTextContent('tối đa 20 đơn');
  });

  it('bỏ trống lý do -> báo lỗi theo field, KHÔNG gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(nameBox(), SHOP.name);
    await user.click(confirmButton());

    expect(await screen.findByText('Vui lòng nhập lý do')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it.each([
    ['để trống', ''],
    ['gõ sai một ký tự', 'Thời Trang Thao'],
    ['sai chữ hoa/thường', 'thời trang thảo'],
    ['chỉ gõ một phần', 'Thời Trang'],
  ])('tên shop %s -> báo "Tên shop không khớp", KHÔNG gọi onConfirm', async (_name, typed) => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(reasonBox(), 'Shop vi phạm.');
    if (typed) await user.type(nameBox(), typed);
    await user.click(confirmButton());

    expect(await screen.findByText('Tên shop không khớp')).toBeInTheDocument();
    expect(nameBox()).toHaveAttribute('aria-invalid', 'true');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('gõ đúng tên (cắt khoảng trắng hai đầu; dấu rời và dấu liền như nhau) + có lý do -> onConfirm nhận lý do đã chuẩn hoá', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(reasonBox(), '  Shop bị khoá, hủy đơn.  ');
    // "ờ" và "ả" viết dạng tổ hợp (chữ + dấu rời) — vẫn phải khớp tên viết dạng dựng sẵn.
    await user.type(nameBox(), ` ${SHOP.name.normalize('NFD')} `);
    await user.click(confirmButton());

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith('Shop bị khoá, hủy đơn.'),
    );
  });

  it('lý do quá dài -> báo lỗi, không gửi; bộ đếm chuyển cảnh báo', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();
    const tooLong = 'a'.repeat(ADMIN_USER_REASON_MAX_LENGTH + 1);

    await user.click(reasonBox());
    await user.paste(tooLong);
    await user.type(nameBox(), SHOP.name);
    await user.click(confirmButton());

    expect(await screen.findByText('Lý do tối đa 500 ký tự')).toBeInTheDocument();
    expect(screen.getByText(`${tooLong.length}/500`)).toHaveClass('text-destructive');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('đang gửi -> khoá ô nhập, nút Quay lại và nút xác nhận (đổi chữ "Đang hủy…")', () => {
    setup({ isPending: true });

    expect(reasonBox()).toBeDisabled();
    expect(nameBox()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
    const confirm = screen.getByRole('button', { name: 'Đang hủy…' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
  });

  it('lỗi cả request hiện ngay trong hộp thoại, giữ nguyên những gì Admin đã gõ', async () => {
    const user = userEvent.setup();
    const { rerender } = setup();
    await user.type(reasonBox(), 'Lý do đã gõ');
    await user.type(nameBox(), SHOP.name);

    rerender(
      withIntl(
        <CancelShopOrdersDialog
          target={SHOP}
          isOpen
          onOpenChange={vi.fn()}
          isPending={false}
          error="Chỉ hủy hàng loạt được khi shop đang bị khoá."
          summary={null}
          onConfirm={vi.fn()}
          onContinue={vi.fn()}
        />,
      ),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Chỉ hủy hàng loạt được khi shop đang bị khoá.',
    );
    expect(reasonBox()).toHaveValue('Lý do đã gõ');
    expect(nameBox()).toHaveValue(SHOP.name);
  });

  it('tên shop chứa HTML hiện dạng text, không thành thẻ', () => {
    setup({ target: { id: 's', name: '<img src=x onerror=alert(1)>' } });

    expect(document.querySelector('img')).toBeNull();
    expect(screen.getAllByText(/<img src=x onerror=alert\(1\)>/).length).toBeGreaterThan(0);
  });
});

describe('CancelShopOrdersDialog — chiều cao', () => {
  // jsdom không có layout nên chỉ khoá cặp lớp; việc đo thật bằng Playwright ở 390x844 (nút xác nhận phải bấm tới được).
  it.each([
    ['form', null],
    ['kết quả', summary({ cancelled: 3 })],
  ])('màn %s: hộp thoại giới hạn theo chiều cao khung nhìn và tự cuộn', (_name, value) => {
    setup({ summary: value });

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveClass('overflow-y-auto');
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]');
  });
});

describe('CancelShopOrdersDialog — kết quả', () => {
  it('đã hủy hết: số đơn đã hủy, không có nút "Hủy tiếp", chỉ nút Đóng', () => {
    setup({ summary: summary({ cancelled: 18 }) });

    expect(screen.getByRole('alertdialog', { name: 'Kết quả hủy đơn' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Đã hủy 18 đơn.');
    expect(screen.queryByRole('button', { name: /Hủy tiếp/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('còn đơn: nói còn bao nhiêu và có nút "Hủy tiếp N đơn" gọi onContinue', async () => {
    const user = userEvent.setup();
    const { onContinue } = setup({ summary: summary({ cancelled: 20, remaining: 7 }) });

    expect(screen.getByRole('status')).toHaveTextContent('Đã hủy 20 đơn.');
    expect(screen.getByRole('status')).toHaveTextContent('Còn 7 đơn chưa giao.');
    await user.click(screen.getByRole('button', { name: 'Hủy tiếp 7 đơn' }));

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('đang chạy lô kế -> khoá nút Hủy tiếp và nút Đóng', () => {
    setup({ isPending: true, summary: summary({ cancelled: 20, remaining: 7 }) });

    expect(screen.getByRole('button', { name: 'Đang hủy…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeDisabled();
  });

  it('không có gì để hủy: câu riêng, không hiện "Đã hủy 0 đơn"', () => {
    setup({ summary: summary() });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Shop không còn đơn chưa giao nào để hủy.',
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('Đã hủy');
  });

  it('đơn không hủy được: mã đơn 8 ký tự + câu lỗi đã dịch theo mã (mã lạ -> câu chung, không lộ mã thô)', () => {
    setup({
      summary: summary({
        cancelled: 1,
        failed: [
          { orderId: '3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f', code: 'ORDER_INVALID_TRANSITION' },
          { orderId: '9b8a7c6d-1111-4222-8333-444455556666', code: 'UNKNOWN' },
          { orderId: '11112222-1111-4222-8333-444455556666', code: 'SOMETHING_NEW' },
        ],
        remaining: 3,
      }),
    });

    const section = screen.getByRole('region', { name: 'Không hủy được 3 đơn' });
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('3f2a9c1e');
    expect(items[0]).not.toHaveTextContent('ORDER_INVALID_TRANSITION');
    expect(items[0].textContent).toMatch(/trạng thái/i);
    expect(items[1]).toHaveTextContent('Lỗi không xác định');
    expect(items[2]).toHaveTextContent('Lỗi không xác định');
    expect(items[2]).not.toHaveTextContent('SOMETHING_NEW');
  });

  it('khoản hoàn bị cổng từ chối: danh sách đơn + số tiền, giải thích và link sang tab hoàn tiền lỗi', () => {
    setup({
      summary: summary({
        cancelled: 2,
        needsManualRefund: [
          { orderId: '3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f', refundId: 'r-1', amount: '220000' },
        ],
      }),
    });

    const section = screen.getByRole('region', { name: 'Cần hoàn tiền tay cho 1 đơn' });
    expect(section).toHaveTextContent('3f2a9c1e');
    expect(section).toHaveTextContent(/220\.000/);
    expect(section).toHaveTextContent('cổng thanh toán từ chối khoản hoàn');
    expect(within(section).getByRole('link', { name: 'Mở màn Hoàn tiền' })).toHaveAttribute(
      'href',
      '/admin/refunds?tab=failed',
    );
  });

  it('khoản hoàn còn chờ cổng chỉ là một dòng thông tin, không bắt Admin hoàn tay', () => {
    setup({ summary: summary({ cancelled: 1, refundsPending: 2 }) });

    expect(screen.getByText(/2 khoản hoàn đang chờ cổng thanh toán/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /hoàn tiền tay/ })).not.toBeInTheDocument();
  });

  it('lỗi của lần gọi sau hiện ở màn kết quả mà KHÔNG xoá kết quả các lần trước', () => {
    setup({
      summary: summary({ cancelled: 20, remaining: 4 }),
      error: 'Chỉ hủy hàng loạt được khi shop đang bị khoá.',
    });

    expect(screen.getByRole('status')).toHaveTextContent('Đã hủy 20 đơn.');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Chỉ hủy hàng loạt được khi shop đang bị khoá.',
    );
  });

  it('bản tiếng Anh: không lộ chuỗi tiếng Việt, số nhiều đúng', () => {
    setup({ summary: summary({ cancelled: 1, remaining: 1 }) }, 'en');

    expect(screen.getByRole('alertdialog', { name: 'Cancellation result' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Cancelled 1 order.');
    expect(screen.getByRole('status')).toHaveTextContent('1 open order remains.');
    expect(
      screen.getByRole('button', { name: 'Cancel the remaining 1 order' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Hủy|Đã|đơn/)).not.toBeInTheDocument();
  });
});

describe('CancelShopOrdersDialog — nút nền đỏ đặc (Week11.md 4.5)', () => {
  const isSolidRed = (button: HTMLElement) =>
    button.classList.contains('bg-destructive') &&
    button.classList.contains('text-background') &&
    // Chế độ tối: không có hai lớp này thì variant destructive giữ nền `dark:bg-destructive/20` (nhạt) đè lên nền đặc.
    button.classList.contains('dark:bg-destructive') &&
    !button.classList.contains('dark:bg-destructive/20') &&
    !button.classList.contains('text-destructive') &&
    !/(^|\s)bg-destructive\//.test(
      button.className
        .replace(/hover:bg-destructive\/90/g, '')
        .replace(/dark:hover:bg-destructive\/90/g, ''),
    );

  it('nút "Hủy các đơn chưa giao" là nền đỏ đặc + chữ nền', () => {
    setup();

    expect(isSolidRed(confirmButton())).toBe(true);
  });

  it('nút "Hủy tiếp N đơn" ở màn kết quả cũng nền đỏ đặc', () => {
    setup({ summary: summary({ cancelled: 20, remaining: 7 }) });

    expect(isSolidRed(screen.getByRole('button', { name: 'Hủy tiếp 7 đơn' }))).toBe(true);
  });
});
