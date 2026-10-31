import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import {
  makeConversationReport,
  makeProductReport,
  makeResolvedProductReport,
  makeResolvedReport,
  makeResolvedShopReport,
  makeReviewReport,
  makeShopReport,
  REPORT_ID,
  REVIEW_ID,
} from '../admin-report.fixtures';
import { adminReportDetailQueryKey } from '../hooks/admin-query-keys';
import * as adminService from '../services/admin.service';
import type { AdminReport } from '../types';
import { AdminReportDetailContainer } from './AdminReportDetailContainer';

const CREATED = Date.parse('2026-10-29T08:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const now = { current: CREATED + 3 * HOUR };

vi.mock('@/shared/hooks/useNow', () => ({ useNow: () => now.current }));
vi.mock('../services/admin.service', () => ({
  getReport: vi.fn(),
  resolveReport: vi.fn(),
  unhideReview: vi.fn(),
  restoreProduct: vi.fn(),
}));
const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

function renderDetail(report: AdminReport | Error, locale: 'vi' | 'en' = 'vi') {
  if (report instanceof Error) vi.mocked(adminService.getReport).mockRejectedValue(report);
  else vi.mocked(adminService.getReport).mockResolvedValue(report);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    withIntl(
      <QueryClientProvider client={queryClient}>
        <AdminReportDetailContainer reportId={REPORT_ID} />
      </QueryClientProvider>,
      locale,
    ),
  );
}

describe('AdminReportDetailContainer (trang chi tiết — phương án A)', () => {
  beforeEach(() => {
    now.current = CREATED + 3 * HOUR;
    vi.mocked(adminService.getReport).mockReset();
    vi.mocked(adminService.resolveReport).mockReset();
    vi.mocked(adminService.unhideReview).mockReset();
    vi.mocked(adminService.restoreProduct).mockReset();
    toastSuccess.mockReset();
  });
  afterEach(() => cleanup());

  describe('tải dữ liệu', () => {
    it('đang tải: khung chờ aria-busy, chưa có panel Xử lý', () => {
      vi.mocked(adminService.getReport).mockReturnValue(new Promise(() => undefined));
      const queryClient = new QueryClient();
      render(
        withIntl(
          <QueryClientProvider client={queryClient}>
            <AdminReportDetailContainer reportId={REPORT_ID} />
          </QueryClientProvider>,
        ),
      );

      expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(screen.queryByText('Xử lý báo cáo')).not.toBeInTheDocument();
      expect(adminService.getReport).toHaveBeenCalledWith(REPORT_ID);
    });

    it('404: câu giải thích + link về hàng đợi, KHÔNG có nút Thử lại', async () => {
      renderDetail(new ApiError('Report not found', 404, 'REPORT_NOT_FOUND'));

      expect(await screen.findByRole('alert')).toHaveTextContent('Không tìm thấy báo cáo này');
      expect(screen.getByRole('link', { name: 'Về danh sách báo cáo' })).toHaveAttribute(
        'href',
        '/admin/reports',
      );
      expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();
    });

    it('lỗi khác (vd 403 — không thử lại tự động): câu chung + nút Thử lại tải lại, không lộ message BE', async () => {
      const user = userEvent.setup();
      renderDetail(new ApiError('Forbidden resource', 403));

      expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được báo cáo');
      expect(screen.queryByText('Forbidden resource')).not.toBeInTheDocument();
      vi.mocked(adminService.getReport).mockResolvedValue(makeReviewReport());
      await user.click(screen.getByRole('button', { name: 'Thử lại' }));

      expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    });
  });

  describe('báo cáo đang chờ xử lý', () => {
    it('tiêu đề nêu loại + đối tượng; đường dẫn quay về hàng đợi; nhãn "Chờ xử lý"', async () => {
      renderDetail(makeReviewReport());

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: 'Đánh giá bị báo cáo: 1★ · Áo thun cotton cổ tròn unisex',
        }),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole('navigation', { name: 'Đường dẫn' })).getByRole('link', {
          name: 'Báo cáo',
        }),
      ).toHaveAttribute('href', '/admin/reports');
      expect(screen.getByText('Chờ xử lý')).toBeInTheDocument();
    });

    it('hai thẻ bên trái: nội dung bị báo (ĐẦY ĐỦ) + lý do (tên và email người báo, mô tả)', async () => {
      renderDetail(makeReviewReport());

      const target = await screen.findByRole('region', { name: 'Nội dung bị báo' });
      expect(within(target).getByText(/ib Zalo 0901 234 567/)).toBeInTheDocument();
      expect(within(target).getByText('Nguyễn Văn Anh')).toBeInTheDocument();
      const reason = screen.getByRole('region', { name: 'Lý do báo cáo' });
      expect(within(reason).getByText('Spam hoặc quảng cáo')).toBeInTheDocument();
      expect(within(reason).getByText(/Người này dán số Zalo/)).toBeInTheDocument();
      expect(within(reason).getByText(/Trần Minh Bảo/)).toBeInTheDocument();
      expect(within(reason).getByText(/minhbao\.tran@example\.com/)).toBeInTheDocument();
    });

    it('không có mô tả ⇒ "Người báo không nhập mô tả"', async () => {
      renderDetail(makeShopReport());

      expect(await screen.findByText('Người báo không nhập mô tả')).toBeInTheDocument();
    });

    it('có người khác cùng báo: nói rõ xử lý sẽ đóng cả N báo cáo; không có ai khác thì không có khối này', async () => {
      renderDetail(makeReviewReport({ sameTargetOpenCount: 2 }));
      expect(
        await screen.findByText(/2 người khác cũng báo cáo đối tượng này.*đóng cả 3 báo cáo/),
      ).toBeInTheDocument();

      cleanup();
      renderDetail(makeReviewReport({ sameTargetOpenCount: 0 }));
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByText(/người khác cũng báo cáo/)).not.toBeInTheDocument();
    });

    it('"Chờ lâu" khi đã chờ từ 48 giờ; không có khi mới gửi', async () => {
      now.current = CREATED + 50 * HOUR;
      renderDetail(makeReviewReport());
      expect(await screen.findByText('Chờ lâu')).toBeInTheDocument();

      cleanup();
      now.current = CREATED + 3 * HOUR;
      renderDetail(makeReviewReport());
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByText('Chờ lâu')).not.toBeInTheDocument();
    });

    it.each([
      [
        'đánh giá',
        makeReviewReport(),
        '/products/c9d8e7f6-1234-4a5b-8c9d-abcdef000009',
        'Xem trang sản phẩm',
      ],
      ['shop', makeShopReport(), '/shops/hang-hieu-gia-si', 'Xem trang shop'],
      // Ảnh chụp sản phẩm không có slug (tên không giới hạn độ dài) nên mở bằng ID của đối tượng.
      [
        'sản phẩm',
        makeProductReport(),
        '/products/e1f2a3b4-1234-4a5b-8c9d-abcdef000011',
        'Xem trang sản phẩm',
      ],
    ])(
      '%s: link sang trang công khai để đối chiếu, mở tab mới an toàn',
      async (_name, report, href, label) => {
        renderDetail(report);

        const link = await screen.findByRole('link', { name: label });
        expect(link).toHaveAttribute('href', href);
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
      },
    );

    it('hội thoại: KHÔNG có link công khai và KHÔNG có nội dung tin nhắn', async () => {
      renderDetail(makeConversationReport());

      const target = await screen.findByRole('region', { name: 'Nội dung bị báo' });
      expect(within(target).getByText('Nguyễn Thị Hồng ↔ Gia Dụng Xinh')).toBeInTheDocument();
      expect(within(target).queryByRole('link')).not.toBeInTheDocument();
    });

    it('báo cáo mở KHÔNG có "Kết quả xử lý" và không có nút "Mở lại đánh giá"', async () => {
      renderDetail(makeReviewReport());

      await screen.findByText('Xử lý báo cáo');
      expect(screen.queryByText('Kết quả xử lý')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Mở lại đánh giá…' })).not.toBeInTheDocument();
    });
  });

  describe('luồng xử lý', () => {
    it('chọn hành động + ghi chú → hộp thoại xác nhận → xác nhận gọi API đúng id + lựa chọn, toast, trang chuyển sang "Kết quả xử lý"', async () => {
      const user = userEvent.setup();
      vi.mocked(adminService.resolveReport).mockResolvedValue(
        makeResolvedReport({}, { note: 'Ngôn từ xúc phạm người bán.' }),
      );
      renderDetail(makeReviewReport({ sameTargetOpenCount: 2 }));
      await screen.findByText('Xử lý báo cáo');

      await user.type(screen.getByLabelText('Ghi chú xử lý'), 'Ngôn từ xúc phạm người bán.');
      await user.click(screen.getByRole('button', { name: 'Ẩn đánh giá…' }));
      // Chưa gọi API: mới chỉ mở hộp thoại xác nhận.
      const dialog = await screen.findByRole('alertdialog', { name: 'Ẩn đánh giá này?' });
      expect(adminService.resolveReport).not.toHaveBeenCalled();
      expect(dialog).toHaveTextContent('Ngôn từ xúc phạm người bán.');
      expect(dialog).toHaveTextContent('Sẽ đóng thêm 2 báo cáo');
      await user.click(within(dialog).getByRole('button', { name: 'Ẩn đánh giá' }));

      await waitFor(() =>
        expect(adminService.resolveReport).toHaveBeenCalledWith(REPORT_ID, {
          action: 'HIDE_REVIEW',
          note: 'Ngôn từ xúc phạm người bán.',
        }),
      );
      expect(await screen.findByText('Kết quả xử lý')).toBeInTheDocument();
      expect(screen.queryByText('Xử lý báo cáo')).not.toBeInTheDocument();
      expect(toastSuccess).toHaveBeenCalledWith('Đã xử lý báo cáo.');
    });

    it('"Bỏ qua" không cần ghi chú: gửi { action: DISMISS } sau xác nhận', async () => {
      const user = userEvent.setup();
      vi.mocked(adminService.resolveReport).mockResolvedValue(
        makeResolvedReport({}, { action: 'DISMISS', note: null }),
      );
      renderDetail(makeReviewReport());
      await screen.findByText('Xử lý báo cáo');

      await user.click(screen.getByRole('radio', { name: /Bỏ qua/ }));
      await user.click(screen.getByRole('button', { name: 'Bỏ qua báo cáo…' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Bỏ qua báo cáo này?' });
      await user.click(within(dialog).getByRole('button', { name: 'Bỏ qua báo cáo' }));

      await waitFor(() =>
        expect(adminService.resolveReport).toHaveBeenCalledWith(REPORT_ID, { action: 'DISMISS' }),
      );
    });

    it('409 Admin khác đã xử lý trước: câu lỗi đã dịch ở đầu panel, hộp thoại đóng, panel Xử lý vẫn còn, KHÔNG toast thành công', async () => {
      const user = userEvent.setup();
      vi.mocked(adminService.resolveReport).mockRejectedValue(
        new ApiError('Report already closed', 409, 'REPORT_ALREADY_CLOSED'),
      );
      renderDetail(makeReviewReport());
      await screen.findByText('Xử lý báo cáo');
      await user.type(screen.getByLabelText('Ghi chú xử lý'), 'Lý do');
      await user.click(screen.getByRole('button', { name: 'Ẩn đánh giá…' }));
      const dialog = await screen.findByRole('alertdialog');

      await user.click(within(dialog).getByRole('button', { name: 'Ẩn đánh giá' }));

      expect(await screen.findByRole('alert')).not.toHaveTextContent('Report already closed');
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(toastSuccess).not.toHaveBeenCalled();
    });

    it('409 mà dữ liệu làm mới cho thấy báo cáo ĐÃ được xử lý: câu lỗi vẫn hiện (nằm ngoài panel) và trang đã đổi sang "Kết quả xử lý"', async () => {
      const user = userEvent.setup();
      vi.mocked(adminService.resolveReport).mockRejectedValue(
        new ApiError('Report already closed', 409, 'REPORT_ALREADY_CLOSED'),
      );
      renderDetail(makeReviewReport());
      await screen.findByText('Xử lý báo cáo');
      await user.type(screen.getByLabelText('Ghi chú xử lý'), 'Lý do');
      await user.click(screen.getByRole('button', { name: 'Ẩn đánh giá…' }));
      const dialog = await screen.findByRole('alertdialog');
      // Lần tải lại sau lỗi trả báo cáo đã được Admin khác xử lý.
      vi.mocked(adminService.getReport).mockResolvedValue(makeResolvedReport());

      await user.click(within(dialog).getByRole('button', { name: 'Ẩn đánh giá' }));

      expect(await screen.findByRole('region', { name: 'Kết quả xử lý' })).toBeInTheDocument();
      expect(screen.queryByText('Xử lý báo cáo')).not.toBeInTheDocument();
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/xử lý/i);
      expect(alert).not.toHaveTextContent('Report already closed');
    });

    it('bắt đầu một lần xử lý mới thì câu lỗi cũ biến mất', async () => {
      const user = userEvent.setup();
      vi.mocked(adminService.resolveReport).mockRejectedValueOnce(
        new ApiError('Report already closed', 409, 'REPORT_ALREADY_CLOSED'),
      );
      renderDetail(makeReviewReport());
      await screen.findByText('Xử lý báo cáo');
      await user.type(screen.getByLabelText('Ghi chú xử lý'), 'Lý do');
      await user.click(screen.getByRole('button', { name: 'Ẩn đánh giá…' }));
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Ẩn đánh giá' }),
      );
      await screen.findByRole('alert');

      await user.click(screen.getByRole('button', { name: 'Ẩn đánh giá…' }));

      await screen.findByRole('alertdialog');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('chưa nhập ghi chú cho hành động huỷ bỏ ⇒ KHÔNG mở hộp thoại xác nhận, KHÔNG gọi API', async () => {
      const user = userEvent.setup();
      renderDetail(makeReviewReport());
      await screen.findByText('Xử lý báo cáo');

      await user.click(screen.getByRole('button', { name: 'Ẩn đánh giá…' }));

      expect(await screen.findByText('Vui lòng nhập lý do xử lý.')).toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(adminService.resolveReport).not.toHaveBeenCalled();
    });
  });

  describe('báo cáo đã xử lý', () => {
    it('thay panel Xử lý bằng "Kết quả xử lý": nhãn, ai xử lý, ghi chú; không còn ô nhập', async () => {
      renderDetail(makeResolvedReport());

      const result = await screen.findByRole('region', { name: 'Kết quả xử lý' });
      expect(within(result).getByText('Đã ẩn đánh giá')).toBeInTheDocument();
      expect(within(result).getByText(/Quản trị Lan/)).toBeInTheDocument();
      expect(within(result).getByText('Ngôn từ xúc phạm người bán.')).toBeInTheDocument();
      expect(screen.queryByLabelText(/Ghi chú xử lý/)).not.toBeInTheDocument();
      expect(screen.queryByText('Chờ xử lý')).not.toBeInTheDocument();
    });

    it('Admin xử lý đã bị xoá tài khoản (resolvedByName null) ⇒ "Quản trị viên đã xoá"', async () => {
      renderDetail(makeResolvedReport({}, { resolvedByName: null }));

      expect(await screen.findByText(/Quản trị viên đã xoá/)).toBeInTheDocument();
    });

    it('hành động lạ BE thêm sau ⇒ nhãn chung "Đã xử lý", không vỡ trang', async () => {
      renderDetail(makeResolvedReport({}, { action: 'MA_LA_MOI' }));

      expect(await screen.findByRole('region', { name: 'Kết quả xử lý' })).toHaveTextContent(
        'Đã xử lý',
      );
    });

    it('báo cáo đã BỎ QUA hoặc không phải đánh giá: KHÔNG có nút "Mở lại đánh giá"', async () => {
      renderDetail(makeResolvedReport({}, { action: 'DISMISS', note: null }));
      await screen.findByRole('region', { name: 'Kết quả xử lý' });
      expect(screen.queryByRole('button', { name: 'Mở lại đánh giá…' })).not.toBeInTheDocument();
    });

    it('đánh giá đã ẩn: có "Mở lại đánh giá"; mở lại gọi API bằng ID ĐÁNH GIÁ (không phải id báo cáo) kèm lý do, rồi báo "đã mở lại"', async () => {
      const user = userEvent.setup();
      vi.mocked(adminService.unhideReview).mockResolvedValue({
        review: { id: REVIEW_ID, isHidden: false, hiddenAt: null },
      });
      renderDetail(makeResolvedReport());
      await user.click(await screen.findByRole('button', { name: 'Mở lại đánh giá…' }));

      const dialog = await screen.findByRole('alertdialog', { name: 'Mở lại đánh giá này?' });
      await user.type(within(dialog).getByLabelText('Lý do mở lại'), 'Đã xét lại, không vi phạm');
      await user.click(within(dialog).getByRole('button', { name: 'Mở lại đánh giá' }));

      await waitFor(() =>
        expect(adminService.unhideReview).toHaveBeenCalledWith(REVIEW_ID, {
          reason: 'Đã xét lại, không vi phạm',
        }),
      );
      expect(adminService.unhideReview).not.toHaveBeenCalledWith(REPORT_ID, expect.anything());
      expect(await screen.findByRole('status')).toHaveTextContent('Đã mở lại đánh giá.');
      expect(screen.queryByRole('button', { name: 'Mở lại đánh giá…' })).not.toBeInTheDocument();
      expect(toastSuccess).toHaveBeenCalledWith('Đã mở lại đánh giá.');
    });

    it('mở lại mà đánh giá đã hiển thị rồi (409 REVIEW_NOT_HIDDEN): câu lỗi ngay trong hộp thoại, hộp thoại GIỮ MỞ, nút "Mở lại" vẫn còn', async () => {
      const user = userEvent.setup();
      vi.mocked(adminService.unhideReview).mockRejectedValue(
        new ApiError('This review is not hidden', 409, 'REVIEW_NOT_HIDDEN'),
      );
      renderDetail(makeResolvedReport());
      await user.click(await screen.findByRole('button', { name: 'Mở lại đánh giá…' }));
      const dialog = await screen.findByRole('alertdialog');
      await user.type(within(dialog).getByLabelText('Lý do mở lại'), 'Lý do');

      await user.click(within(dialog).getByRole('button', { name: 'Mở lại đánh giá' }));

      expect(await within(dialog).findByRole('alert')).not.toHaveTextContent(
        'This review is not hidden',
      );
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(toastSuccess).not.toHaveBeenCalled();
    });

    it('thử mở lại lần nữa sau lỗi: câu lỗi cũ biến mất ngay khi gửi lại, không chờ kết quả', async () => {
      const user = userEvent.setup();
      vi.mocked(adminService.unhideReview)
        .mockRejectedValueOnce(new ApiError('This review is not hidden', 409, 'REVIEW_NOT_HIDDEN'))
        .mockReturnValueOnce(new Promise(() => undefined));
      renderDetail(makeResolvedReport());
      await user.click(await screen.findByRole('button', { name: 'Mở lại đánh giá…' }));
      const dialog = await screen.findByRole('alertdialog');
      await user.type(within(dialog).getByLabelText('Lý do mở lại'), 'Lý do');
      await user.click(within(dialog).getByRole('button', { name: 'Mở lại đánh giá' }));
      await within(dialog).findByRole('alert');

      await user.click(within(dialog).getByRole('button', { name: 'Mở lại đánh giá' }));

      await waitFor(() => expect(adminService.unhideReview).toHaveBeenCalledTimes(2));
      expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('đang mở lại: Esc không đóng được hộp thoại cho tới khi xong', async () => {
      const user = userEvent.setup();
      let finish: (value: {
        review: { id: string; isHidden: boolean; hiddenAt: null };
      }) => void = () => undefined;
      vi.mocked(adminService.unhideReview).mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      renderDetail(makeResolvedReport());
      await user.click(await screen.findByRole('button', { name: 'Mở lại đánh giá…' }));
      const dialog = await screen.findByRole('alertdialog');
      await user.type(within(dialog).getByLabelText('Lý do mở lại'), 'Lý do');
      await user.click(within(dialog).getByRole('button', { name: 'Mở lại đánh giá' }));
      await waitFor(() => expect(adminService.unhideReview).toHaveBeenCalledTimes(1));

      await user.keyboard('{Escape}');

      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      await act(async () => finish({ review: { id: REVIEW_ID, isHidden: false, hiddenAt: null } }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    });
  });

  describe('báo cáo sản phẩm đã gỡ — khôi phục và link trang công khai (Week11.md 5.7)', () => {
    const PRODUCT_LINK = /Xem trang sản phẩm/;
    const TAKEN_DOWN_NOTE = 'Sản phẩm đã bị gỡ — không còn trang công khai';

    it('đã gỡ: thay link "Xem trang sản phẩm" (sẽ là trang 404) bằng nhãn vô hiệu nói rõ lý do', async () => {
      renderDetail(makeResolvedProductReport());

      expect(await screen.findByText(TAKEN_DOWN_NOTE)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: PRODUCT_LINK })).not.toBeInTheDocument();
    });

    it('sản phẩm mà kết quả xử lý ghi là KHOÁ SHOP (dữ liệu lệch) ⇒ giữ link tới trang sản phẩm, không có nhãn "đã bị gỡ"', async () => {
      renderDetail(makeResolvedProductReport({}, { action: 'SUSPEND_SHOP' }));

      expect(await screen.findByRole('link', { name: PRODUCT_LINK })).toBeInTheDocument();
      expect(screen.queryByText(TAKEN_DOWN_NOTE)).not.toBeInTheDocument();
    });

    it('báo cáo của loại KHÁC mà kết quả ghi là gỡ sản phẩm (dữ liệu lệch) ⇒ vẫn giữ link tới trang shop, không có nhãn "đã bị gỡ"', async () => {
      renderDetail({
        ...makeShopReport(),
        status: 'RESOLVED',
        resolution: makeResolvedProductReport().resolution,
      } as AdminReport);

      expect(await screen.findByRole('link', { name: /Xem trang shop/ })).toBeInTheDocument();
      expect(screen.queryByText(TAKEN_DOWN_NOTE)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Khôi phục sản phẩm/ })).not.toBeInTheDocument();
    });

    it('báo cáo còn mở: giữ link tới trang sản phẩm (sản phẩm vẫn đang bán), không có nhãn "đã bị gỡ"', async () => {
      renderDetail(makeProductReport());

      const link = await screen.findByRole('link', { name: PRODUCT_LINK });
      expect(link).toHaveAttribute('href', expect.stringContaining('/products/'));
      expect(screen.queryByText(TAKEN_DOWN_NOTE)).not.toBeInTheDocument();
    });

    it('đã BỎ QUA (sản phẩm không bị gỡ): giữ link tới trang sản phẩm và không có nút khôi phục', async () => {
      renderDetail(makeResolvedProductReport({}, { action: 'DISMISS', note: null }));

      expect(await screen.findByRole('link', { name: PRODUCT_LINK })).toBeInTheDocument();
      expect(screen.queryByText(TAKEN_DOWN_NOTE)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Khôi phục sản phẩm/ })).not.toBeInTheDocument();
    });

    it('đã gỡ: có nút "Khôi phục sản phẩm…" kèm câu giải thích; KHÔNG có nút "Mở lại đánh giá"', async () => {
      renderDetail(makeResolvedProductReport());

      expect(
        await screen.findByRole('button', { name: 'Khôi phục sản phẩm…' }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Sản phẩm về trạng thái nháp để chủ shop sửa/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Mở lại đánh giá/ })).not.toBeInTheDocument();
    });

    it('khôi phục: gọi API bằng ID SẢN PHẨM (không phải id báo cáo) kèm lý do, rồi báo xong, đổi nhãn và bỏ nút', async () => {
      const user = userEvent.setup();
      const report = makeResolvedProductReport();
      vi.mocked(adminService.restoreProduct).mockResolvedValue({
        product: { id: report.targetId, status: 'DRAFT', takenDownAt: null },
      });
      renderDetail(report);
      await user.click(await screen.findByRole('button', { name: 'Khôi phục sản phẩm…' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Khôi phục sản phẩm này?' });
      await user.type(
        within(dialog).getByLabelText('Lý do khôi phục'),
        'Đã xét lại, không vi phạm',
      );

      await user.click(within(dialog).getByRole('button', { name: 'Khôi phục sản phẩm' }));

      await waitFor(() =>
        expect(adminService.restoreProduct).toHaveBeenCalledWith(report.targetId, {
          reason: 'Đã xét lại, không vi phạm',
        }),
      );
      expect(adminService.restoreProduct).not.toHaveBeenCalledWith(report.id, expect.anything());
      expect(await screen.findByRole('status')).toHaveTextContent('Đã khôi phục sản phẩm về nháp.');
      expect(screen.queryByRole('button', { name: 'Khôi phục sản phẩm…' })).not.toBeInTheDocument();
      expect(
        screen.getByText('Đã khôi phục về nháp — chưa hiển thị công khai'),
      ).toBeInTheDocument();
      expect(screen.queryByText(TAKEN_DOWN_NOTE)).not.toBeInTheDocument();
      expect(toastSuccess).toHaveBeenCalledWith('Đã khôi phục sản phẩm về nháp.');
    });

    it('đang khôi phục: ô nhập và nút xác nhận bị khoá (báo bận), Esc không đóng được hộp thoại', async () => {
      const user = userEvent.setup();
      vi.mocked(adminService.restoreProduct).mockReturnValue(new Promise(() => undefined));
      renderDetail(makeResolvedProductReport());
      await user.click(await screen.findByRole('button', { name: 'Khôi phục sản phẩm…' }));
      const dialog = await screen.findByRole('alertdialog');
      await user.type(within(dialog).getByLabelText('Lý do khôi phục'), 'Lý do');

      await user.click(within(dialog).getByRole('button', { name: 'Khôi phục sản phẩm' }));

      await waitFor(() => expect(adminService.restoreProduct).toHaveBeenCalledTimes(1));
      expect(within(dialog).getByLabelText('Lý do khôi phục')).toBeDisabled();
      expect(within(dialog).getByRole('button', { name: 'Khôi phục sản phẩm' })).toBeDisabled();
      expect(within(dialog).getByRole('button', { name: 'Quay lại' })).toBeDisabled();
      await user.keyboard('{Escape}');
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });

    it('bỏ trống lý do ⇒ báo lỗi ngay trong hộp thoại, KHÔNG gọi API', async () => {
      const user = userEvent.setup();
      renderDetail(makeResolvedProductReport());
      await user.click(await screen.findByRole('button', { name: 'Khôi phục sản phẩm…' }));
      const dialog = await screen.findByRole('alertdialog');

      await user.click(within(dialog).getByRole('button', { name: 'Khôi phục sản phẩm' }));

      expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
      expect(adminService.restoreProduct).not.toHaveBeenCalled();
    });

    it('sản phẩm không còn ở trạng thái bị gỡ (409 PRODUCT_NOT_TAKEN_DOWN): câu lỗi trong hộp thoại, hộp thoại GIỮ MỞ, nút vẫn còn', async () => {
      const user = userEvent.setup();
      vi.mocked(adminService.restoreProduct).mockRejectedValue(
        new ApiError('This product is not taken down', 409, 'PRODUCT_NOT_TAKEN_DOWN'),
      );
      renderDetail(makeResolvedProductReport());
      await user.click(await screen.findByRole('button', { name: 'Khôi phục sản phẩm…' }));
      const dialog = await screen.findByRole('alertdialog');
      await user.type(within(dialog).getByLabelText('Lý do khôi phục'), 'Lý do');

      await user.click(within(dialog).getByRole('button', { name: 'Khôi phục sản phẩm' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Sản phẩm này không ở trạng thái bị gỡ, không có gì để khôi phục.',
      );
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(screen.getByText(TAKEN_DOWN_NOTE)).toBeInTheDocument();
    });

    it('tiếng Anh: nút, hộp thoại và nhãn đều có bản dịch, không lẫn tiếng Việt', async () => {
      const user = userEvent.setup();
      renderDetail(makeResolvedProductReport(), 'en');

      expect(
        await screen.findByText('Product taken down — it has no public page'),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Restore product…' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Restore this product?' });

      expect(within(dialog).getByLabelText('Reason for restoring')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Restore product' })).toBeInTheDocument();
    });
  });

  describe('báo cáo shop đã khoá — link trang shop (Week11.md 5.7, đồng bộ với sản phẩm bị gỡ)', () => {
    const SHOP_NOTE = 'Shop đã bị khoá — không còn trang công khai';

    it('đã khoá: thay link "Xem trang shop" (sẽ là trang 404) bằng nhãn vô hiệu + đường tới tab "Bị khoá" của quản lý shop', async () => {
      renderDetail(makeResolvedShopReport());

      expect(await screen.findByText(SHOP_NOTE)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Xem trang shop/ })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Mở trong quản lý shop' })).toHaveAttribute(
        'href',
        '/admin/shops?status=SUSPENDED',
      );
    });

    it('báo cáo còn mở hoặc đã BỎ QUA: giữ link tới trang shop công khai, không có nhãn và không có đường quản lý', async () => {
      const { unmount } = renderDetail(makeShopReport());
      expect(await screen.findByRole('link', { name: /Xem trang shop/ })).toHaveAttribute(
        'href',
        expect.stringContaining('/shops/'),
      );
      expect(screen.queryByText(SHOP_NOTE)).not.toBeInTheDocument();
      unmount();

      renderDetail(makeResolvedShopReport({}, { action: 'DISMISS', note: null }));
      expect(await screen.findByRole('link', { name: /Xem trang shop/ })).toBeInTheDocument();
      expect(screen.queryByText(SHOP_NOTE)).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Mở trong quản lý shop' })).not.toBeInTheDocument();
    });

    it('khoá shop KHÔNG có nút hoàn tác trong trang báo cáo (mở khoá làm ở quản lý shop)', async () => {
      renderDetail(makeResolvedShopReport());

      await screen.findByText(SHOP_NOTE);
      expect(
        screen.queryByRole('button', { name: /Khôi phục|Mở lại|Mở khoá/ }),
      ).not.toBeInTheDocument();
    });

    it('tiếng Anh: nhãn và đường dẫn đều có bản dịch', async () => {
      renderDetail(makeResolvedShopReport(), 'en');

      expect(await screen.findByText('Shop suspended — it has no public page')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open in shop management' })).toBeInTheDocument();
    });
  });

  describe('đổi sang báo cáo khác trên cùng một trang', () => {
    it('dữ liệu báo cáo mới đã có sẵn trong cache ⇒ ô ghi chú KHÔNG mang chữ đã gõ cho báo cáo trước', async () => {
      const user = userEvent.setup();
      const first = makeReviewReport();
      const second = makeShopReport();
      vi.mocked(adminService.getReport).mockImplementation(async (id) =>
        id === second.id ? second : first,
      );
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      queryClient.setQueryData(adminReportDetailQueryKey(second.id), second);
      const page = (reportId: string) =>
        withIntl(
          <QueryClientProvider client={queryClient}>
            <AdminReportDetailContainer reportId={reportId} />
          </QueryClientProvider>,
        );
      const { rerender } = render(page(first.id));
      await user.type(await screen.findByLabelText('Ghi chú xử lý'), 'Chữ dành cho báo cáo đầu');

      rerender(page(second.id));

      await screen.findByRole('heading', { level: 1, name: /Shop Hàng Hiệu Giá Sỉ/ });
      expect(screen.getByLabelText('Ghi chú xử lý')).toHaveValue('');
    });
  });

  it('tiếng Anh: không lẫn chuỗi tiếng Việt ở tiêu đề, thẻ và panel', async () => {
    renderDetail(makeReviewReport(), 'en');

    expect(
      await screen.findByRole('heading', { level: 1, name: /^Reported Review: 1★/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Reported content')).toBeInTheDocument();
    expect(screen.getByText('Handle report')).toBeInTheDocument();
  });
});
