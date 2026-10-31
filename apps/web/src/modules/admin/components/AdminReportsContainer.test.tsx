import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import {
  makeConversationReport,
  makeProductReport,
  makeReportPage,
  makeResolvedReport,
  makeReviewReport,
  makeShopReport,
} from '../admin-report.fixtures';
import { AdminReportsContainer } from './AdminReportsContainer';

const CREATED = Date.parse('2026-10-29T08:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const media = { isWide: true };
const now = { current: CREATED + 72 * HOUR };
const query = {
  current: {
    data: undefined as ReturnType<typeof makeReportPage> | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
};
const useAdminReports = vi.fn();

vi.mock('@/shared/hooks/useMediaQuery', () => ({ useMediaQuery: () => media.isWide }));
vi.mock('@/shared/hooks/useNow', () => ({ useNow: () => now.current }));
vi.mock('../hooks/useAdminReports', () => ({
  useAdminReports: (args: unknown) => {
    useAdminReports(args);
    return query.current;
  },
}));

const REVIEW = makeReviewReport({ sameTargetOpenCount: 2 });
const SHOP = makeShopReport({ createdAt: new Date(CREATED + 70 * HOUR).toISOString() });
const PRODUCT = makeProductReport({ createdAt: new Date(CREATED + 71 * HOUR).toISOString() });

function setQuery(partial: Partial<typeof query.current>) {
  query.current = {
    data: undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...partial,
  };
}

function renderContainer(props: Partial<React.ComponentProps<typeof AdminReportsContainer>> = {}) {
  return render(
    withIntl(<AdminReportsContainer status="OPEN" targetType={undefined} page={1} {...props} />),
  );
}

describe('AdminReportsContainer (hàng đợi báo cáo — phương án B)', () => {
  beforeEach(() => {
    media.isWide = true;
    now.current = CREATED + 72 * HOUR;
    useAdminReports.mockReset();
    setQuery({});
  });
  afterEach(() => cleanup());

  describe('truy vấn và điều khiển', () => {
    it('gọi hook với đúng tab, loại và trang đọc từ URL', () => {
      setQuery({ data: makeReportPage([REVIEW]) });

      renderContainer({ status: 'CLOSED', targetType: 'SHOP', page: 3 });

      expect(useAdminReports).toHaveBeenCalledWith({
        status: 'CLOSED',
        targetType: 'SHOP',
        page: 3,
      });
    });

    it('hai tab là LINK giữ nguyên loại đang lọc; tab đang xem có aria-current', () => {
      setQuery({ data: makeReportPage([REVIEW]) });
      renderContainer({ status: 'OPEN', targetType: 'SHOP' });

      const open = screen.getByRole('link', { name: 'Chờ xử lý' });
      const closed = screen.getByRole('link', { name: 'Đã xử lý' });
      expect(open).toHaveAttribute('aria-current', 'page');
      expect(open).toHaveAttribute('href', '/admin/reports?type=SHOP');
      expect(closed).not.toHaveAttribute('aria-current');
      expect(closed).toHaveAttribute('href', '/admin/reports?status=CLOSED&type=SHOP');
    });

    it('chip lọc theo loại là LINK giữ nguyên tab; "Tất cả" sáng khi chưa lọc', () => {
      setQuery({ data: makeReportPage([REVIEW]) });
      renderContainer({ status: 'CLOSED', targetType: undefined });

      const filter = screen.getByRole('navigation', { name: 'Lọc theo loại' });
      expect(within(filter).getByRole('link', { name: 'Tất cả' })).toHaveAttribute(
        'aria-current',
        'true',
      );
      expect(within(filter).getByRole('link', { name: 'Shop' })).toHaveAttribute(
        'href',
        '/admin/reports?status=CLOSED&type=SHOP',
      );
      expect(within(filter).getByRole('link', { name: 'Sản phẩm' })).not.toHaveAttribute(
        'aria-current',
      );
    });

    it('đang lọc một loại: chip đó sáng, "Tất cả" không sáng', () => {
      setQuery({ data: makeReportPage([SHOP]) });
      renderContainer({ targetType: 'SHOP' });

      const filter = screen.getByRole('navigation', { name: 'Lọc theo loại' });
      expect(within(filter).getByRole('link', { name: 'Shop' })).toHaveAttribute(
        'aria-current',
        'true',
      );
      expect(within(filter).getByRole('link', { name: 'Tất cả' })).not.toHaveAttribute(
        'aria-current',
      );
    });
  });

  describe('đang tải, lỗi, rỗng', () => {
    it('đang tải: khung chờ có aria-busy, controls vẫn hiện, chưa có dòng nào', () => {
      setQuery({ isPending: true });
      renderContainer();

      expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(screen.getByRole('link', { name: 'Chờ xử lý' })).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Danh sách báo cáo' })).not.toBeInTheDocument();
    });

    it('lỗi và chưa có dữ liệu: câu lỗi (role=alert, không lộ message BE) + nút Thử lại gọi refetch', async () => {
      const user = userEvent.setup();
      const refetch = vi.fn();
      setQuery({ isError: true, refetch });
      renderContainer();

      expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh sách shop');
      await user.click(screen.getByRole('button', { name: 'Thử lại' }));

      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('lần tải lại ngầm lỗi nhưng ĐÃ có dữ liệu: vẫn hiện danh sách, không thay bằng câu lỗi', () => {
      setQuery({ data: makeReportPage([REVIEW]), isError: true });
      renderContainer();

      expect(screen.getByRole('list', { name: 'Danh sách báo cáo' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('tab Chờ xử lý rỗng: câu + gợi ý về chuông thông báo, KHÔNG có danh sách', () => {
      setQuery({ data: makeReportPage([]) });
      renderContainer({ status: 'OPEN' });

      expect(screen.getByText('Không có báo cáo nào đang chờ xử lý')).toBeInTheDocument();
      expect(screen.getByText(/chuông thông báo/)).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Danh sách báo cáo' })).not.toBeInTheDocument();
    });

    it('tab Đã xử lý rỗng: câu riêng', () => {
      setQuery({ data: makeReportPage([]) });
      renderContainer({ status: 'CLOSED' });

      expect(screen.getByText('Chưa có báo cáo nào được xử lý')).toBeInTheDocument();
    });
  });

  describe('các dòng của hàng đợi', () => {
    beforeEach(() => setQuery({ data: makeReportPage([REVIEW, SHOP, PRODUCT]) }));

    it('mỗi dòng: tên đối tượng + "lý do · thời gian tương đối"; loại đọc được bằng trình đọc màn hình', () => {
      renderContainer();

      const list = screen.getByRole('list', { name: 'Danh sách báo cáo' });
      const rows = within(list).getAllByRole('listitem');
      expect(rows).toHaveLength(3);
      expect(rows[0]).toHaveTextContent('1★ · Áo thun cotton cổ tròn unisex');
      expect(rows[0]).toHaveTextContent('Spam hoặc quảng cáo · 3 ngày trước');
      expect(rows[1]).toHaveTextContent('Shop Hàng Hiệu Giá Sỉ');
      expect(rows[1]).toHaveTextContent('Hàng giả, hàng nhái');
      expect(rows[0]).toHaveTextContent('Đánh giá:');
      expect(rows[1]).toHaveTextContent('Shop:');
    });

    it('"+N người khác" chỉ ở báo cáo có người khác cùng báo', () => {
      renderContainer();

      // Chỉ tính trong DANH SÁCH: ở màn rộng khung xem nhanh của dòng đang chọn cũng có cùng huy hiệu.
      const list = screen.getByRole('list', { name: 'Danh sách báo cáo' });
      expect(within(list).getAllByText('+2 người khác')).toHaveLength(1);
      expect(within(list).queryByText('+0 người khác')).not.toBeInTheDocument();
    });

    it('"Chờ lâu" chỉ ở báo cáo mở từ 48 giờ trở lên (suy từ giờ hiện tại), có title giải thích mốc', () => {
      renderContainer();

      const list = screen.getByRole('list', { name: 'Danh sách báo cáo' });
      const slow = within(list).getAllByText('Chờ lâu');
      expect(slow).toHaveLength(1);
      expect(slow[0].closest('[title]')).toHaveAttribute('title', 'Đã chờ từ 48 giờ trở lên');
      expect(
        within(within(list).getAllByRole('listitem')[0]).getByText('Chờ lâu'),
      ).toBeInTheDocument();
    });

    it('đúng mốc 48 giờ: bắt đầu bị gắn "Chờ lâu"; thiếu một phút thì chưa', () => {
      now.current = CREATED + 48 * HOUR - 60_000;
      setQuery({ data: makeReportPage([REVIEW]) });
      const { unmount } = renderContainer();
      expect(screen.queryByText('Chờ lâu')).not.toBeInTheDocument();
      unmount();

      now.current = CREATED + 48 * HOUR;
      renderContainer();
      const list = screen.getByRole('list', { name: 'Danh sách báo cáo' });
      expect(within(list).getByText('Chờ lâu')).toBeInTheDocument();
    });

    it('tab Đã xử lý: không bao giờ có "Chờ lâu", dù báo cáo cũ', () => {
      setQuery({ data: makeReportPage([makeResolvedReport()]) });
      renderContainer({ status: 'CLOSED' });

      expect(screen.queryByText('Chờ lâu')).not.toBeInTheDocument();
    });

    it('chữ do người dùng nhập (tên dài không dấu cách) bị cắt trong dòng, không đẩy rộng khung; title mang bản đầy đủ', () => {
      const longName = 'W'.repeat(300);
      setQuery({
        data: makeReportPage([makeShopReport({ snapshot: { name: longName, slug: 'x' } })]),
      });
      renderContainer();

      const title = screen.getByTitle(longName);
      expect(title.className).toContain('truncate');
    });
  });

  describe('màn RỘNG (xl): bấm dòng là chọn để xem nhanh', () => {
    beforeEach(() => setQuery({ data: makeReportPage([REVIEW, SHOP, PRODUCT]) }));

    it('dòng là nút (không phải link); dòng đầu được chọn sẵn và khung xem nhanh hiện nội dung ĐẦY ĐỦ của nó', () => {
      renderContainer();

      const rows = screen.getAllByRole('button');
      expect(rows).toHaveLength(3);
      expect(rows[0]).toHaveAttribute('aria-current', 'true');
      expect(rows[1]).not.toHaveAttribute('aria-current');
      const preview = screen.getByRole('complementary', { name: 'Xem nhanh báo cáo' });
      expect(within(preview).getByText(/ib Zalo 0901 234 567/)).toBeInTheDocument();
      expect(within(preview).getByText('Nguyễn Văn Anh')).toBeInTheDocument();
    });

    it('bấm dòng khác: khung xem nhanh đổi sang báo cáo đó và aria-current chuyển theo', async () => {
      const user = userEvent.setup();
      renderContainer();

      await user.click(screen.getAllByRole('button')[1]);

      const preview = screen.getByRole('complementary', { name: 'Xem nhanh báo cáo' });
      expect(within(preview).getByText('Shop Hàng Hiệu Giá Sỉ')).toBeInTheDocument();
      expect(within(preview).queryByText(/ib Zalo/)).not.toBeInTheDocument();
      expect(screen.getAllByRole('button')[1]).toHaveAttribute('aria-current', 'true');
      expect(screen.getAllByRole('button')[0]).not.toHaveAttribute('aria-current');
    });

    it('dòng đang chọn có nền muted nên chữ phụ đậm hơn (text-foreground/75), dòng khác giữ text-muted-foreground', () => {
      renderContainer();

      const rows = screen.getAllByRole('button');
      expect(within(rows[0]).getByText(/Spam hoặc quảng cáo/).className).toContain(
        'text-foreground/75',
      );
      expect(within(rows[1]).getByText(/Hàng giả, hàng nhái/).className).toContain(
        'text-muted-foreground',
      );
    });

    it('khung xem nhanh chỉ ĐỌC: có link "Mở để xử lý" tới trang chi tiết đúng báo cáo, và KHÔNG có nút hành động huỷ bỏ nào', () => {
      renderContainer();

      const preview = screen.getByRole('complementary', { name: 'Xem nhanh báo cáo' });
      expect(within(preview).getByRole('link', { name: 'Mở để xử lý' })).toHaveAttribute(
        'href',
        `/admin/reports/${REVIEW.id}`,
      );
      expect(within(preview).queryByRole('button')).not.toBeInTheDocument();
    });

    it('danh sách đổi và dòng đã chọn biến mất (xử lý xong / đổi tab): rơi về dòng đầu, không để khung trống', async () => {
      const user = userEvent.setup();
      const { rerender } = renderContainer();
      await user.click(screen.getAllByRole('button')[2]);
      expect(screen.getByRole('complementary')).toHaveTextContent('Dao bấm tự động lò xo 21cm');

      setQuery({ data: makeReportPage([REVIEW, SHOP]) });
      rerender(withIntl(<AdminReportsContainer status="OPEN" targetType={undefined} page={1} />));

      expect(screen.getByRole('complementary')).toHaveTextContent('Áo thun cotton cổ tròn unisex');
    });

    it('báo cáo hội thoại ở khung xem nhanh: chỉ tên hai bên + vai người báo, KHÔNG có nội dung tin nhắn', () => {
      setQuery({ data: makeReportPage([makeConversationReport()]) });
      renderContainer();

      const preview = screen.getByRole('complementary', { name: 'Xem nhanh báo cáo' });
      expect(preview).toHaveTextContent('Nguyễn Thị Hồng ↔ Gia Dụng Xinh');
      expect(preview).toHaveTextContent(
        'Người báo là chủ shop. Nội dung tin nhắn không nằm trong báo cáo.',
      );
    });

    it('báo cáo đã xử lý: nút đổi thành "Xem lại" và hiện kết quả', () => {
      setQuery({ data: makeReportPage([makeResolvedReport()]) });
      renderContainer({ status: 'CLOSED' });

      const preview = screen.getByRole('complementary', { name: 'Xem nhanh báo cáo' });
      expect(within(preview).getByText('Đã ẩn đánh giá')).toBeInTheDocument();
      expect(within(preview).getByRole('link', { name: 'Xem lại' })).toBeInTheDocument();
    });
  });

  describe('màn HẸP (dưới xl): không có khung xem nhanh', () => {
    beforeEach(() => {
      media.isWide = false;
      setQuery({ data: makeReportPage([REVIEW, SHOP]) });
    });

    it('mỗi dòng là LINK sang trang chi tiết; không có khung xem nhanh và không có nút chọn', () => {
      renderContainer();

      const list = screen.getByRole('list', { name: 'Danh sách báo cáo' });
      const links = within(list).getAllByRole('link');
      expect(links[0]).toHaveAttribute('href', `/admin/reports/${REVIEW.id}`);
      expect(links[1]).toHaveAttribute('href', `/admin/reports/${SHOP.id}`);
      expect(within(list).queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
      expect(links[0]).not.toHaveAttribute('aria-current');
    });
  });

  describe('phân trang', () => {
    it('nhiều trang: có thanh Trước / Sau giữ đúng tab và loại', () => {
      setQuery({ data: makeReportPage([REVIEW], { total: 95, limit: 20 }) });
      renderContainer({ status: 'CLOSED', targetType: 'SHOP', page: 2 });

      expect(screen.getByRole('link', { name: 'Trang trước' })).toHaveAttribute(
        'href',
        '/admin/reports?status=CLOSED&type=SHOP',
      );
      expect(screen.getByRole('link', { name: 'Trang sau' })).toHaveAttribute(
        'href',
        '/admin/reports?status=CLOSED&type=SHOP&page=3',
      );
    });

    it('một trang: không có thanh phân trang', () => {
      setQuery({ data: makeReportPage([REVIEW]) });
      renderContainer();

      expect(screen.queryByRole('link', { name: 'Trang sau' })).not.toBeInTheDocument();
    });
  });

  it('tiếng Anh: nhãn tab, chip và huy hiệu không lẫn chuỗi tiếng Việt', () => {
    setQuery({ data: makeReportPage([REVIEW]) });
    render(withIntl(<AdminReportsContainer status="OPEN" targetType={undefined} page={1} />, 'en'));

    expect(screen.getByRole('link', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Handled' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Report list' });
    expect(within(list).getByText('+2 others')).toBeInTheDocument();
    expect(within(list).getByText('Waiting long')).toBeInTheDocument();
    expect(screen.getAllByText(/Spam or advertising/).length).toBeGreaterThan(0);
  });
});
