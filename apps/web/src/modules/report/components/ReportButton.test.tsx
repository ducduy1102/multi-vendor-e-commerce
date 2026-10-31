import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import * as reportService from '../services/report.service';
import { ReportButton } from './ReportButton';

vi.mock('../services/report.service', () => ({ createReport: vi.fn() }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const TARGET_ID = '11111111-1111-4111-8111-111111111111';
const RECEIPT = {
  id: 'report-1',
  targetType: 'REVIEW' as const,
  status: 'OPEN' as const,
  createdAt: '2026-10-31T01:00:00.000Z',
};

function setup(locale: 'vi' | 'en' = 'vi') {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    withIntl(
      <QueryClientProvider client={queryClient}>
        <ReportButton targetType="REVIEW" targetId={TARGET_ID} />
      </QueryClientProvider>,
      locale,
    ),
  );
}

const trigger = () => screen.getByRole('button', { name: 'Báo cáo' });
const submit = () => screen.getByRole('button', { name: 'Gửi báo cáo' });

beforeEach(() => {
  vi.mocked(reportService.createReport).mockReset();
  toastSuccess.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ReportButton', () => {
  it('lúc đầu chỉ có nút "Báo cáo", chưa mở hộp thoại', () => {
    setup();

    expect(trigger()).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('bấm nút mở hộp thoại đúng loại đối tượng', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(trigger());

    expect(
      await screen.findByRole('alertdialog', { name: 'Báo cáo đánh giá này' }),
    ).toBeInTheDocument();
  });

  it('gửi thành công: gọi service đúng payload, đóng hộp thoại, toast, nút đổi thành "Đã gửi báo cáo"', async () => {
    const user = userEvent.setup();
    vi.mocked(reportService.createReport).mockResolvedValue(RECEIPT);
    setup();

    await user.click(trigger());
    await user.click(await screen.findByRole('radio', { name: 'Spam hoặc quảng cáo' }));
    await user.click(submit());

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(vi.mocked(reportService.createReport).mock.calls[0][0]).toEqual({
      targetType: 'REVIEW',
      targetId: TARGET_ID,
      reasonCode: 'SPAM',
      note: undefined,
    });
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('Đã gửi báo cáo'));
    expect(screen.getByRole('status')).toHaveTextContent('Đã gửi báo cáo');
    expect(screen.queryByRole('button', { name: 'Báo cáo' })).not.toBeInTheDocument();
  });

  it('lỗi có mã nghiệp vụ (409 REPORT_ALREADY_OPEN): câu đã dịch ngay trong hộp thoại, hộp thoại GIỮ MỞ với lựa chọn cũ, không toast', async () => {
    const user = userEvent.setup();
    vi.mocked(reportService.createReport).mockRejectedValue(
      new ApiError('Already reported', 409, 'REPORT_ALREADY_OPEN'),
    );
    setup();

    await user.click(trigger());
    await user.click(await screen.findByRole('radio', { name: 'Ngôn từ xúc phạm' }));
    await user.click(submit());

    expect(
      await screen.findByText('Bạn đã có một báo cáo đang chờ xử lý về nội dung này.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Ngôn từ xúc phạm' })).toBeChecked();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByText('Đã gửi báo cáo')).not.toBeInTheDocument();
  });

  it('lỗi không rõ (mất mạng) ⇒ câu chung, không lộ message gốc', async () => {
    const user = userEvent.setup();
    vi.mocked(reportService.createReport).mockRejectedValue(new TypeError('Failed to fetch'));
    setup();

    await user.click(trigger());
    await user.click(await screen.findByRole('radio', { name: 'Spam hoặc quảng cáo' }));
    await user.click(submit());

    expect(await screen.findByText('Không thể gửi báo cáo. Vui lòng thử lại.')).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  });

  it('đóng hộp thoại rồi mở lại: lỗi cũ được xoá, form trống', async () => {
    const user = userEvent.setup();
    vi.mocked(reportService.createReport).mockRejectedValue(
      new ApiError('x', 429, 'REPORT_LIMIT_REACHED'),
    );
    setup();

    await user.click(trigger());
    await user.click(await screen.findByRole('radio', { name: 'Spam hoặc quảng cáo' }));
    await user.click(submit());
    expect(await screen.findByText(/quá nhiều báo cáo/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await user.click(trigger());

    await screen.findByRole('alertdialog');
    expect(screen.queryByText(/quá nhiều báo cáo/)).not.toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
  });

  it('đang gửi: bấm Esc không đóng hộp thoại (không làm mất kết quả của yêu cầu đang bay)', async () => {
    const user = userEvent.setup();
    let resolveRequest: (value: typeof RECEIPT) => void = () => undefined;
    vi.mocked(reportService.createReport).mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    setup();

    await user.click(trigger());
    await user.click(await screen.findByRole('radio', { name: 'Spam hoặc quảng cáo' }));
    await user.click(submit());
    await screen.findByRole('button', { name: 'Đang gửi...' });
    await user.keyboard('{Escape}');

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    resolveRequest(RECEIPT);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Đã gửi báo cáo');
  });

  it('tiếng Anh: "Report" → "Report sent"', async () => {
    const user = userEvent.setup();
    vi.mocked(reportService.createReport).mockResolvedValue(RECEIPT);
    setup('en');

    await user.click(screen.getByRole('button', { name: 'Report' }));
    await user.click(await screen.findByRole('radio', { name: 'Spam or advertising' }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Report sent'));
  });
});
