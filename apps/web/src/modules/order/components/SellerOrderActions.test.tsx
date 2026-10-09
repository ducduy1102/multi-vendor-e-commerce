import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { SellerOrderListItem } from '../types';
import { SellerOrderActions } from './SellerOrderActions';

type Flags = Pick<
  SellerOrderListItem,
  'canConfirm' | 'canPack' | 'canShip' | 'canReject' | 'canCancel'
>;
const NO_FLAGS: Flags = {
  canConfirm: false,
  canPack: false,
  canShip: false,
  canReject: false,
  canCancel: false,
};

// `status` + `refundRequest` chỉ để chọn lời giải thích cho nút bị khoá; mặc định là đơn không có yêu cầu nào.
type Context = Pick<SellerOrderListItem, 'status' | 'refundRequest'>;
const NO_CONTEXT: Context = { status: 'PENDING', refundRequest: null };

type RefundSummary = NonNullable<SellerOrderListItem['refundRequest']>;

const refundRequest = (
  status: RefundSummary['status'],
  kind: RefundSummary['kind'] = 'CANCEL',
): RefundSummary => ({
  id: 'request-1',
  kind,
  status,
  sellerRespondBy: '2026-10-03T03:00:00.000Z',
});

function setup(flags: Partial<Flags> = {}, isDisabled = false, context: Partial<Context> = {}) {
  const handlers = {
    onConfirm: vi.fn(),
    onPack: vi.fn(),
    onShip: vi.fn(),
    onReject: vi.fn(),
    onCancel: vi.fn(),
  };
  const utils = render(
    withIntl(
      <SellerOrderActions
        order={{ ...NO_FLAGS, ...NO_CONTEXT, ...flags, ...context }}
        isDisabled={isDisabled}
        {...handlers}
      />,
    ),
  );
  return { ...utils, ...handlers };
}

describe('SellerOrderActions', () => {
  it('không cờ nào bật -> không render gì (đơn đã giao/hoàn tất/hủy không có nút)', () => {
    const { container } = setup();

    expect(container).toBeEmptyDOMElement();
  });

  it('đơn COD chờ xác nhận: "Xác nhận" và "Từ chối", bấm gọi đúng callback', async () => {
    const user = userEvent.setup();
    const { onConfirm, onReject, onPack, onShip, onCancel } = setup({
      canConfirm: true,
      canReject: true,
    });

    await user.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await user.click(screen.getByRole('button', { name: 'Từ chối' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onPack).not.toHaveBeenCalled();
    expect(onShip).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Đóng gói' })).not.toBeInTheDocument();
  });

  it('đơn đã trả online chờ xác nhận: chỉ "Xác nhận", KHÔNG có "Từ chối" (BE không bật canReject)', () => {
    setup({ canConfirm: true });

    expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Từ chối' })).not.toBeInTheDocument();
  });

  it('đã xác nhận: chỉ "Đóng gói"', async () => {
    const user = userEvent.setup();
    const { onPack } = setup({ canPack: true });

    expect(screen.getAllByRole('button')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Đóng gói' }));

    expect(onPack).toHaveBeenCalledTimes(1);
  });

  it('đã đóng gói: chỉ "Giao hàng"', async () => {
    const user = userEvent.setup();
    const { onShip } = setup({ canShip: true });

    expect(screen.getAllByRole('button')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Giao hàng' }));

    expect(onShip).toHaveBeenCalledTimes(1);
  });

  it('đang có hành động chạy (isDisabled) -> khoá mọi nút, bấm không gọi callback', async () => {
    const user = userEvent.setup();
    const { onConfirm, onReject } = setup({ canConfirm: true, canReject: true }, true);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toBeDisabled();
    await user.click(buttons[0]);
    await user.click(buttons[1]);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  describe('hủy đơn đã xác nhận/đóng gói (canCancel)', () => {
    it('canCancel bật -> có "Hủy đơn" (outline, trung tính), bấm gọi onCancel', async () => {
      const user = userEvent.setup();
      const { onCancel, onConfirm } = setup({ canCancel: true, canPack: true });

      const cancel = screen.getByRole('button', { name: 'Hủy đơn' });
      expect(cancel).toHaveClass('border-border');
      expect(cancel).not.toHaveClass('bg-destructive');
      await user.click(cancel);

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Đóng gói' })).toBeEnabled();
    });

    it('chỉ canCancel bật (không cờ nào khác) vẫn render nút, không bị coi là "không có hành động"', () => {
      const { container } = setup({ canCancel: true });

      expect(container).not.toBeEmptyDOMElement();
      expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('canCancel tắt -> không có "Hủy đơn" (BE quyết, FE không tự suy theo trạng thái)', () => {
      setup({ canPack: true }, false, { status: 'CONFIRMED' });

      expect(screen.queryByRole('button', { name: 'Hủy đơn' })).not.toBeInTheDocument();
    });

    it('đang có hành động chạy -> "Hủy đơn" cũng bị khoá', async () => {
      const user = userEvent.setup();
      const { onCancel } = setup({ canCancel: true }, true);

      const cancel = screen.getByRole('button', { name: 'Hủy đơn' });
      expect(cancel).toBeDisabled();
      await user.click(cancel);

      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe('người mua đang xin hủy -> đóng gói/giao hàng bị khoá kèm giải thích', () => {
    it('đã xác nhận + yêu cầu hủy chờ shop: "Đóng gói" khoá, có dòng giải thích gắn qua aria-describedby', async () => {
      const user = userEvent.setup();
      const { onPack } = setup({ canPack: false }, false, {
        status: 'CONFIRMED',
        refundRequest: refundRequest('PENDING_SELLER'),
      });

      const pack = screen.getByRole('button', { name: 'Đóng gói' });
      expect(pack).toBeDisabled();
      const hint = screen.getByText(/Người mua đang xin hủy đơn này/);
      expect(pack).toHaveAttribute('aria-describedby', hint.id);
      expect(screen.queryByRole('button', { name: 'Giao hàng' })).not.toBeInTheDocument();
      await user.click(pack);

      expect(onPack).not.toHaveBeenCalled();
    });

    it('đã đóng gói + yêu cầu hủy đã lên sàn: "Giao hàng" khoá (không phải "Đóng gói")', () => {
      setup({ canShip: false }, false, {
        status: 'PACKED',
        refundRequest: refundRequest('ESCALATED'),
      });

      expect(screen.getByRole('button', { name: 'Giao hàng' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Đóng gói' })).not.toBeInTheDocument();
      expect(screen.getByText(/Người mua đang xin hủy đơn này/)).toBeInTheDocument();
    });

    it('nút khoá đi cùng "Hủy đơn": shop vẫn tự hủy được khi chưa muốn trả lời yêu cầu', () => {
      setup({ canCancel: true }, false, {
        status: 'CONFIRMED',
        refundRequest: refundRequest('PENDING_SELLER'),
      });

      expect(screen.getByRole('button', { name: 'Đóng gói' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Hủy đơn' })).toBeEnabled();
    });

    it('BE vẫn bật canPack (dù có yêu cầu) -> chỉ 1 nút "Đóng gói" bật, KHÔNG thêm nút khoá, không có dòng giải thích', () => {
      setup({ canPack: true }, false, {
        status: 'CONFIRMED',
        refundRequest: refundRequest('PENDING_SELLER'),
      });

      expect(screen.getAllByRole('button', { name: 'Đóng gói' })).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Đóng gói' })).toBeEnabled();
      expect(screen.queryByText(/Người mua đang xin hủy đơn này/)).not.toBeInTheDocument();
    });

    it.each([
      ['yêu cầu hủy đã được chấp thuận', refundRequest('APPROVED')],
      ['shop đã từ chối yêu cầu hủy', refundRequest('REJECTED_BY_SELLER')],
      ['sàn đã từ chối yêu cầu hủy', refundRequest('REJECTED')],
      ['yêu cầu TRẢ HÀNG (không chặn đóng gói)', refundRequest('PENDING_SELLER', 'RETURN')],
    ])('%s -> không nút khoá, không giải thích (đơn không render gì)', (_label, request) => {
      const { container } = setup({}, false, { status: 'CONFIRMED', refundRequest: request });

      expect(container).toBeEmptyDOMElement();
    });
  });
});
