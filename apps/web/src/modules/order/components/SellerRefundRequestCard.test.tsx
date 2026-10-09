import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { SellerRefundRequest } from '../types';
import { SellerRefundRequestCard } from './SellerRefundRequestCard';

const created = {
  toStatus: 'PENDING_SELLER',
  actorType: 'BUYER',
  note: null,
  createdAt: '2026-10-01T03:00:00.000Z',
} as const;

function request(overrides: Partial<SellerRefundRequest> = {}): SellerRefundRequest {
  return {
    id: 'request-1',
    kind: 'CANCEL',
    status: 'PENDING_SELLER',
    sellerRespondBy: '2026-10-03T03:00:00.000Z',
    reasonCode: 'CHANGE_OF_MIND',
    reasonNote: null,
    statusChangedAt: '2026-10-01T03:00:00.000Z',
    createdAt: '2026-10-01T03:00:00.000Z',
    history: [created],
    canApprove: false,
    canReject: false,
    ...overrides,
  };
}

function setup(overrides: Partial<SellerRefundRequest> = {}, isDisabled = false) {
  const onApprove = vi.fn();
  const onReject = vi.fn();
  const utils = render(
    withIntl(
      <SellerRefundRequestCard
        request={request(overrides)}
        isDisabled={isDisabled}
        onApprove={onApprove}
        onReject={onReject}
      />,
    ),
  );
  return { ...utils, onApprove, onReject };
}

describe('SellerRefundRequestCard — chờ shop phản hồi', () => {
  it('yêu cầu HỦY: tiêu đề, huy hiệu, HẠN phản hồi và hệ quả quá hạn (đơn tự hủy)', () => {
    setup();

    expect(screen.getByRole('heading', { name: 'Yêu cầu hủy đơn' })).toBeInTheDocument();
    expect(screen.getByText('Chờ shop phản hồi')).toBeInTheDocument();
    expect(screen.getByText(/Hạn phản hồi: .*2026/)).toBeInTheDocument();
    expect(screen.getByText(/đơn sẽ tự động bị hủy/)).toBeInTheDocument();
  });

  it('yêu cầu TRẢ HÀNG: hệ quả quá hạn khác — chuyển lên sàn xử lý, không tự duyệt', () => {
    setup({ kind: 'RETURN', reasonCode: 'DAMAGED' });

    expect(screen.getByRole('heading', { name: 'Yêu cầu trả hàng/hoàn tiền' })).toBeInTheDocument();
    expect(screen.getByText(/chuyển lên sàn xử lý/)).toBeInTheDocument();
    expect(screen.queryByText(/tự động bị hủy/)).not.toBeInTheDocument();
  });

  it('hiện lý do và mô tả của NGƯỜI MUA (shop cần đọc để quyết định)', () => {
    setup({ reasonCode: 'WRONG_ITEM', reasonNote: 'Nhận áo size M thay vì L' });

    expect(screen.getByText('Lý do của người mua: Giao sai sản phẩm')).toBeInTheDocument();
    expect(screen.getByText('Mô tả: Nhận áo size M thay vì L')).toBeInTheDocument();
  });

  it('không có mô tả -> không có dòng "Mô tả"', () => {
    setup({ reasonNote: null });

    expect(screen.queryByText(/^Mô tả:/)).not.toBeInTheDocument();
  });

  it('mã lý do BE thêm sau mà FE chưa biết -> "Lý do khác", không lộ mã thô', () => {
    setup({ reasonCode: 'SOME_FUTURE_REASON' });

    expect(screen.getByText('Lý do của người mua: Lý do khác')).toBeInTheDocument();
    expect(screen.queryByText(/SOME_FUTURE_REASON/)).not.toBeInTheDocument();
  });
});

describe('SellerRefundRequestCard — nút Chấp thuận / Từ chối chỉ theo cờ của BE', () => {
  it('không cờ nào -> không có nút (kể cả khi đang chờ shop)', () => {
    setup({ canApprove: false, canReject: false });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('canApprove + canReject -> cả hai nút, bấm gọi đúng callback (hộp thoại xác nhận ở Container)', async () => {
    const user = userEvent.setup();
    const { onApprove, onReject } = setup({ canApprove: true, canReject: true });

    await user.click(screen.getByRole('button', { name: 'Chấp thuận yêu cầu' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Từ chối yêu cầu' }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('"Chấp thuận" là nút chính (primary), "Từ chối" là outline — không nút nào đỏ hay cam', () => {
    setup({ canApprove: true, canReject: true });

    expect(screen.getByRole('button', { name: 'Chấp thuận yêu cầu' })).toHaveClass('bg-primary');
    const reject = screen.getByRole('button', { name: 'Từ chối yêu cầu' });
    expect(reject).toHaveClass('border-border');
    expect(reject).not.toHaveClass('bg-destructive/10');
  });

  it('chỉ canApprove (yêu cầu hủy đã lên sàn: shop nhượng bộ) -> chỉ có "Chấp thuận"', () => {
    setup({ status: 'ESCALATED', canApprove: true, canReject: false });

    expect(screen.getByRole('button', { name: 'Chấp thuận yêu cầu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Từ chối yêu cầu' })).not.toBeInTheDocument();
  });

  it('chỉ canReject (cờ độc lập, không suy từ nhau) -> chỉ có "Từ chối yêu cầu", KHÔNG có "Chấp thuận"', () => {
    setup({ canApprove: false, canReject: true });

    expect(screen.getByRole('button', { name: 'Từ chối yêu cầu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chấp thuận yêu cầu' })).not.toBeInTheDocument();
  });

  it('đang có hành động chạy (isDisabled) -> khoá cả hai nút, bấm không gọi callback', async () => {
    const user = userEvent.setup();
    const { onApprove, onReject } = setup({ canApprove: true, canReject: true }, true);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toBeDisabled();
      await user.click(button);
    }

    expect(onApprove).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });
});

describe('SellerRefundRequestCard — các trạng thái khác', () => {
  it('đã lên sàn (yêu cầu hủy, có thể nhượng bộ): giải thích + gợi ý chấp thuận được ngay, KHÔNG còn hạn phản hồi', () => {
    setup({ status: 'ESCALATED', canApprove: true });

    expect(screen.getByText('Chờ sàn xem xét')).toBeInTheDocument();
    expect(screen.getByText(/Người mua đã khiếu nại lên sàn/)).toBeInTheDocument();
    expect(screen.getByText(/Bạn vẫn có thể chấp thuận ngay để hủy đơn/)).toBeInTheDocument();
    expect(screen.queryByText(/Hạn phản hồi/)).not.toBeInTheDocument();
  });

  it('đã lên sàn (yêu cầu TRẢ HÀNG, sàn quyết): không có gợi ý nhượng bộ và không có nút', () => {
    setup({ kind: 'RETURN', status: 'ESCALATED', canApprove: false, canReject: false });

    expect(screen.getByText(/Người mua đã khiếu nại lên sàn/)).toBeInTheDocument();
    expect(screen.queryByText(/chấp thuận ngay/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['APPROVED', 'Đã chấp thuận'],
    ['REJECTED_BY_SELLER', 'Shop đã từ chối'],
    ['REJECTED', 'Sàn đã từ chối'],
  ] as const)('đã xử lý (%s): huy hiệu "%s", không hạn phản hồi, không nút', (status, label) => {
    setup({ status });

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(/Hạn phản hồi/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('SellerRefundRequestCard — dòng thời gian kể theo góc nhìn của shop', () => {
  it('bước đầu là "Người mua đã gửi yêu cầu" (không phải "Bạn đã gửi yêu cầu" của người mua)', () => {
    setup();

    const timeline = screen.getByRole('list');
    expect(within(timeline).getByText('Người mua đã gửi yêu cầu')).toBeInTheDocument();
    expect(within(timeline).queryByText('Bạn đã gửi yêu cầu')).not.toBeInTheDocument();
  });

  it('mới nhất lên đầu; lý do của chính shop đọc là "Lý do của bạn", của sàn là "Lý do của sàn"', () => {
    setup({
      status: 'REJECTED',
      history: [
        created,
        {
          toStatus: 'REJECTED_BY_SELLER',
          actorType: 'SELLER',
          note: 'Hàng đã gửi đúng mẫu',
          createdAt: '2026-10-02T03:00:00.000Z',
        },
        {
          toStatus: 'ESCALATED',
          actorType: 'BUYER',
          note: null,
          createdAt: '2026-10-03T03:00:00.000Z',
        },
        {
          toStatus: 'REJECTED',
          actorType: 'ADMIN',
          note: 'Thiếu bằng chứng hư hỏng',
          createdAt: '2026-10-04T03:00:00.000Z',
        },
      ],
    });

    const steps = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps[0]).toHaveTextContent('Sàn đã từ chối yêu cầu');
    expect(steps[0]).toHaveTextContent('Lý do của sàn: Thiếu bằng chứng hư hỏng');
    expect(steps[1]).toHaveTextContent('Người mua đã khiếu nại lên sàn');
    expect(steps[2]).toHaveTextContent('Bạn đã từ chối yêu cầu');
    expect(steps[2]).toHaveTextContent('Lý do của bạn: Hàng đã gửi đúng mẫu');
    expect(steps[3]).toHaveTextContent('Người mua đã gửi yêu cầu');
    expect(screen.queryByText(/Lý do của shop/)).not.toBeInTheDocument();
  });

  it('shop không phản hồi đúng hạn: câu của hệ thống kể bằng "bạn", KHÔNG hiện ghi chú nội bộ của hệ thống', () => {
    setup({
      kind: 'RETURN',
      status: 'ESCALATED',
      history: [
        created,
        {
          toStatus: 'ESCALATED',
          actorType: 'SYSTEM',
          note: 'Seller response deadline passed',
          createdAt: '2026-10-03T03:00:00.000Z',
        },
      ],
    });

    expect(
      screen.getByText('Yêu cầu được chuyển lên sàn do bạn không phản hồi đúng hạn'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Seller response deadline passed/)).not.toBeInTheDocument();
  });
});

describe('SellerRefundRequestCard — chữ do người dùng nhập không phá bố cục', () => {
  it('lý do/mô tả 500 ký tự liền: ngắt được chữ, mô tả giữ xuống dòng, lưới khai cột tường minh', () => {
    const { container } = setup({ reasonNote: 'a'.repeat(500) });

    const note = screen.getByText(`Mô tả: ${'a'.repeat(500)}`);
    expect(note).toHaveClass('break-words', 'whitespace-pre-line');
    // jsdom không có layout nên không đo được độ rộng; giữ các lớp này để không ai vô tình bỏ đi.
    for (const grid of container.querySelectorAll('.grid')) {
      expect(grid, grid.className).toHaveClass('grid-cols-1');
    }
  });
});
