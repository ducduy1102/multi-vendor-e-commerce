import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../../messages/en.json';
import { withIntl } from '@/shared/lib/test-i18n';

import type { BuyerRefundRequest } from '../types';
import { RefundRequestCard } from './RefundRequestCard';

const created = {
  toStatus: 'PENDING_SELLER',
  actorType: 'BUYER',
  note: null,
  createdAt: '2026-10-01T03:00:00.000Z',
} as const;

function request(overrides: Partial<BuyerRefundRequest> = {}): BuyerRefundRequest {
  return {
    id: 'request-1',
    kind: 'CANCEL',
    status: 'PENDING_SELLER',
    reasonCode: 'CHANGE_OF_MIND',
    reasonNote: null,
    sellerRespondBy: '2026-10-03T03:00:00.000Z',
    statusChangedAt: '2026-10-01T03:00:00.000Z',
    createdAt: '2026-10-01T03:00:00.000Z',
    history: [created],
    canWithdraw: false,
    canEscalate: false,
    ...overrides,
  };
}

function setup(overrides: Partial<BuyerRefundRequest> = {}, isDisabled = false) {
  const onWithdraw = vi.fn();
  const onEscalate = vi.fn();
  const utils = render(
    withIntl(
      <RefundRequestCard
        request={request(overrides)}
        isDisabled={isDisabled}
        onWithdraw={onWithdraw}
        onEscalate={onEscalate}
      />,
    ),
  );
  return { ...utils, onWithdraw, onEscalate };
}

const withHistory = (...history: BuyerRefundRequest['history']) => ({ history });

describe('RefundRequestCard — mỗi trạng thái', () => {
  it('chờ shop phản hồi: huy hiệu + HẠN shop phản hồi; chưa rút được thì không có nút', () => {
    setup();

    expect(screen.getByText('Chờ shop phản hồi')).toBeInTheDocument();
    expect(screen.getByText(/Shop cần phản hồi trước .*2026/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('chờ shop phản hồi + canWithdraw: có nút "Rút yêu cầu", bấm gọi onWithdraw (hộp thoại xác nhận ở Container)', async () => {
    const user = userEvent.setup();
    const { onWithdraw, onEscalate } = setup({ canWithdraw: true });

    await user.click(screen.getByRole('button', { name: 'Rút yêu cầu' }));

    expect(onWithdraw).toHaveBeenCalledTimes(1);
    expect(onEscalate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Khiếu nại với sàn' })).not.toBeInTheDocument();
  });

  it('shop đã từ chối + canEscalate: huy hiệu cảnh báo, lý do của shop ở dòng thời gian, gợi ý + nút "Khiếu nại với sàn"', async () => {
    const user = userEvent.setup();
    const { onEscalate } = setup({
      status: 'REJECTED_BY_SELLER',
      canEscalate: true,
      ...withHistory(created, {
        toStatus: 'REJECTED_BY_SELLER',
        actorType: 'SELLER',
        note: 'Hàng đã giao cho vận chuyển',
        createdAt: '2026-10-02T03:00:00.000Z',
      }),
    });

    expect(screen.getByText('Shop đã từ chối')).toBeInTheDocument();
    expect(screen.getByText('Lý do của shop: Hàng đã giao cho vận chuyển')).toBeInTheDocument();
    expect(screen.getByText(/có thể khiếu nại lên sàn/)).toBeInTheDocument();
    expect(screen.queryByText(/Shop cần phản hồi trước/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Khiếu nại với sàn' }));
    expect(onEscalate).toHaveBeenCalledTimes(1);
  });

  it('shop đã từ chối nhưng HẾT HẠN khiếu nại (canEscalate = false): không còn nút lẫn gợi ý — FE không tự suy cửa sổ', () => {
    setup({
      status: 'REJECTED_BY_SELLER',
      canEscalate: false,
      ...withHistory(created, {
        toStatus: 'REJECTED_BY_SELLER',
        actorType: 'SELLER',
        note: 'Không đủ điều kiện',
        createdAt: '2026-10-02T03:00:00.000Z',
      }),
    });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/có thể khiếu nại lên sàn/)).not.toBeInTheDocument();
    expect(screen.getByText('Lý do của shop: Không đủ điều kiện')).toBeInTheDocument();
  });

  it('đã khiếu nại: "Chờ sàn xem xét", không còn nút nào, dòng thời gian có bước khiếu nại', () => {
    setup({
      status: 'ESCALATED',
      ...withHistory(
        created,
        {
          toStatus: 'REJECTED_BY_SELLER',
          actorType: 'SELLER',
          note: null,
          createdAt: '2026-10-02T03:00:00.000Z',
        },
        {
          toStatus: 'ESCALATED',
          actorType: 'BUYER',
          note: null,
          createdAt: '2026-10-03T03:00:00.000Z',
        },
      ),
    });

    expect(screen.getByText('Chờ sàn xem xét')).toBeInTheDocument();
    expect(screen.getByText('Bạn đã khiếu nại lên sàn')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('đã chấp thuận (shop / sàn / tự động do shop không phản hồi): nhãn đúng người quyết định', () => {
    const { unmount } = setup({
      status: 'APPROVED',
      ...withHistory(created, {
        toStatus: 'APPROVED',
        actorType: 'SELLER',
        note: null,
        createdAt: '2026-10-02T03:00:00.000Z',
      }),
    });
    expect(screen.getAllByText('Đã chấp thuận').length).toBeGreaterThan(0);
    expect(screen.getByText('Shop đã chấp thuận yêu cầu')).toBeInTheDocument();
    unmount();

    const second = setup({
      status: 'APPROVED',
      ...withHistory(created, {
        toStatus: 'APPROVED',
        actorType: 'SYSTEM',
        note: 'Seller response deadline passed',
        createdAt: '2026-10-04T03:00:00.000Z',
      }),
    });
    expect(
      screen.getByText('Yêu cầu được tự động chấp thuận do shop không phản hồi đúng hạn'),
    ).toBeInTheDocument();
    // note của HỆ THỐNG là chuỗi nội bộ tiếng Anh — không được hiện ra.
    expect(screen.queryByText(/Seller response deadline/)).not.toBeInTheDocument();
    second.unmount();

    setup({
      status: 'APPROVED',
      ...withHistory(created, {
        toStatus: 'APPROVED',
        actorType: 'ADMIN',
        note: null,
        createdAt: '2026-10-05T03:00:00.000Z',
      }),
    });
    expect(screen.getByText('Sàn đã chấp thuận yêu cầu')).toBeInTheDocument();
  });

  it('sàn đã từ chối: "Sàn đã từ chối" + lý do của sàn ở dòng thời gian, không còn nút', () => {
    setup({
      status: 'REJECTED',
      ...withHistory(created, {
        toStatus: 'REJECTED',
        actorType: 'ADMIN',
        note: 'Thiếu bằng chứng hư hỏng',
        createdAt: '2026-10-05T03:00:00.000Z',
      }),
    });

    expect(screen.getAllByText('Sàn đã từ chối yêu cầu').length).toBeGreaterThan(0);
    expect(screen.getByText('Lý do của sàn: Thiếu bằng chứng hư hỏng')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('đã rút (BE thường ẩn yêu cầu đã rút, nhưng nếu có vẫn hiển thị được)', () => {
    setup({
      status: 'WITHDRAWN',
      ...withHistory(created, {
        toStatus: 'WITHDRAWN',
        actorType: 'BUYER',
        note: null,
        createdAt: '2026-10-01T05:00:00.000Z',
      }),
    });

    expect(screen.getAllByText('Đã rút').length).toBeGreaterThan(0);
    expect(screen.getByText('Bạn đã rút yêu cầu')).toBeInTheDocument();
  });
});

describe('RefundRequestCard — nội dung', () => {
  it('tiêu đề theo loại yêu cầu: hủy đơn / trả hàng-hoàn tiền', () => {
    const { unmount } = setup({ kind: 'CANCEL' });
    expect(screen.getByRole('heading', { name: 'Yêu cầu hủy đơn' })).toBeInTheDocument();
    unmount();

    setup({ kind: 'RETURN' });
    expect(screen.getByRole('heading', { name: 'Yêu cầu trả hàng/hoàn tiền' })).toBeInTheDocument();
  });

  it('lý do hiện bằng NHÃN dịch (không phải mã thô); mã lạ rơi về "Lý do khác"; mô tả của người mua hiện kèm', () => {
    const { unmount } = setup({ reasonCode: 'DAMAGED', reasonNote: 'Rách tay áo' });
    expect(screen.getByText('Lý do của bạn: Hàng bị hư hỏng, vỡ')).toBeInTheDocument();
    expect(screen.getByText('Mô tả: Rách tay áo')).toBeInTheDocument();
    expect(screen.queryByText(/DAMAGED/)).not.toBeInTheDocument();
    unmount();

    setup({ reasonCode: 'SOMETHING_FUTURE' });
    expect(screen.getByText('Lý do của bạn: Lý do khác')).toBeInTheDocument();
    expect(screen.queryByText(/SOMETHING_FUTURE/)).not.toBeInTheDocument();
  });

  it('dòng thời gian dựng từ history, MỚI NHẤT lên đầu, bước mới nhất là aria-current="step"', () => {
    setup({
      status: 'ESCALATED',
      ...withHistory(
        created,
        {
          toStatus: 'REJECTED_BY_SELLER',
          actorType: 'SELLER',
          note: 'x',
          createdAt: '2026-10-02T03:00:00.000Z',
        },
        {
          toStatus: 'ESCALATED',
          actorType: 'BUYER',
          note: null,
          createdAt: '2026-10-03T03:00:00.000Z',
        },
      ),
    });

    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(within(steps[0]).getByText('Bạn đã khiếu nại lên sàn')).toBeInTheDocument();
    expect(within(steps[1]).getByText('Shop đã từ chối yêu cầu')).toBeInTheDocument();
    expect(within(steps[2]).getByText('Bạn đã gửi yêu cầu')).toBeInTheDocument();
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(steps[1]).not.toHaveAttribute('aria-current');
  });

  it('history rỗng -> không render khối "Diễn biến yêu cầu"', () => {
    setup({ history: [] });

    expect(screen.queryByText('Diễn biến yêu cầu')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('chữ do người dùng/shop/sàn nhập (mô tả 500 ký tự liền, lý do từ chối) ngắt được và nằm trong lưới 1 cột', () => {
    setup({
      reasonNote: 'a'.repeat(500),
      status: 'REJECTED_BY_SELLER',
      ...withHistory(created, {
        toStatus: 'REJECTED_BY_SELLER',
        actorType: 'SELLER',
        note: 'b'.repeat(500),
        createdAt: '2026-10-02T03:00:00.000Z',
      }),
    });

    const note = screen.getByText(`Mô tả: ${'a'.repeat(500)}`);
    expect(note).toHaveClass('break-words', 'whitespace-pre-line');
    expect(note.parentElement).toHaveClass('grid-cols-1');
    const shopReason = screen.getByText(`Lý do của shop: ${'b'.repeat(500)}`);
    expect(shopReason).toHaveClass('break-words');
    expect(shopReason.parentElement).toHaveClass('min-w-0');
  });
});

describe('RefundRequestCard — nút', () => {
  it('isDisabled khoá cả hai nút, bấm không gọi callback', async () => {
    const user = userEvent.setup();
    const { onWithdraw, onEscalate } = setup({ canWithdraw: true, canEscalate: true }, true);

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
      await user.click(button);
    }

    expect(onWithdraw).not.toHaveBeenCalled();
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it('nút cao ≥ 36px; "Khiếu nại với sàn" là hành động chính, "Rút yêu cầu" là nút phụ (outline)', () => {
    setup({ canWithdraw: true, canEscalate: true });

    const escalate = screen.getByRole('button', { name: 'Khiếu nại với sàn' });
    const withdraw = screen.getByRole('button', { name: 'Rút yêu cầu' });
    expect(escalate).toHaveClass('min-h-9', 'bg-primary');
    expect(withdraw).toHaveClass('min-h-9');
    expect(withdraw).not.toHaveClass('bg-primary');
  });
});

describe('RefundRequestCard — tiếng Anh', () => {
  it('nhãn trạng thái, tiêu đề, lý do và dòng thời gian bằng tiếng Anh', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <RefundRequestCard
          request={request({
            kind: 'RETURN',
            reasonCode: 'WRONG_ITEM',
            status: 'REJECTED_BY_SELLER',
            canEscalate: true,
            history: [
              created,
              {
                toStatus: 'REJECTED_BY_SELLER',
                actorType: 'SELLER',
                note: 'Not covered',
                createdAt: '2026-10-02T03:00:00.000Z',
              },
            ],
          })}
          isDisabled={false}
          onWithdraw={() => {}}
          onEscalate={() => {}}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Return/refund request' })).toBeInTheDocument();
    expect(screen.getByText('Rejected by the shop')).toBeInTheDocument();
    expect(screen.getByText('Your reason: Received the wrong item')).toBeInTheDocument();
    expect(screen.getByText("Shop's reason: Not covered")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Escalate to the marketplace' })).toBeInTheDocument();
  });
});
