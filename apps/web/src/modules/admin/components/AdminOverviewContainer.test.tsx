import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { AdminOverview } from '../types';
import { AdminOverviewContainer } from './AdminOverviewContainer';

const query = vi.hoisted(() => ({
  current: {} as {
    data?: AdminOverview;
    isPending: boolean;
    isFetching: boolean;
    refetch: () => Promise<unknown>;
  },
}));
vi.mock('../hooks/useAdminOverview', () => ({ useAdminOverview: () => query.current }));

const WORK: AdminOverview = {
  pendingShops: 128,
  escalatedRefundRequests: 2,
  refundsNeedingAction: 14,
  refundablePayments: 0,
};

function setQuery(partial: Partial<typeof query.current>) {
  query.current = {
    data: undefined,
    isPending: false,
    isFetching: false,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...partial,
  };
}

function renderContainer() {
  return render(withIntl(<AdminOverviewContainer />));
}

// Container có phần rẽ nhánh theo trạng thái (đang tải / lỗi / rỗng / có dữ liệu) và quyết định khối "Khu quản trị" có hiện
// hay không, nên test bằng hook giả thay vì chỉ trông cậy vào Playwright.
describe('AdminOverviewContainer', () => {
  beforeEach(() => setQuery({}));

  it('đang tải -> vùng aria-busy có chữ sr-only, khung chờ ẩn khỏi trình đọc màn hình, KHÔNG có thẻ nào, vẫn có lối tắt', () => {
    setQuery({ isPending: true });
    renderContainer();

    const busy = screen.getByRole('region', { name: 'Việc cần xử lý' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveTextContent('Đang tải...');
    expect(
      screen.queryAllByRole('heading', { level: 2, name: /Khiếu nại|Hoàn tiền lỗi/ }),
    ).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Khu quản trị' })).toBeInTheDocument();
  });

  it('lỗi và chưa có số -> alert + nút thử lại gọi refetch; vẫn có lối tắt', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    setQuery({ refetch });
    renderContainer();

    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được số việc đang chờ.');
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Khu quản trị' })).toBeInTheDocument();
  });

  it('lỗi nhưng ĐÃ có số (lần tải lại ngầm lỗi) -> vẫn hiện số, không báo lỗi', () => {
    setQuery({ data: WORK });
    renderContainer();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Khiếu nại đã lên sàn' })).toBeInTheDocument();
  });

  it('có việc -> bốn thẻ theo thứ tự độ gấp với đúng số; thẻ 0 việc không là link; có khối lối tắt', () => {
    setQuery({ data: WORK });
    renderContainer();

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      'Khiếu nại đã lên sàn',
      'Hoàn tiền lỗi',
      'Thanh toán cần hoàn',
      'Shop chờ duyệt',
      'Khu quản trị',
    ]);
    expect(screen.getByRole('link', { name: /Khiếu nại đã lên sàn/ })).toHaveTextContent('2');
    expect(screen.getByRole('link', { name: /Hoàn tiền lỗi/ })).toHaveTextContent('14');
    expect(screen.getByRole('link', { name: /Shop chờ duyệt/ })).toHaveTextContent('128');
    expect(screen.queryByRole('link', { name: /Thanh toán cần hoàn/ })).not.toBeInTheDocument();
    expect(screen.getByText('Không có việc chờ')).toBeInTheDocument();
  });

  it('không còn việc nào -> khối "Không còn việc nào chờ xử lý" THAY thẻ và KHÔNG hiện thêm khối lối tắt (hai nút đã là lối đi)', () => {
    setQuery({
      data: {
        pendingShops: 0,
        escalatedRefundRequests: 0,
        refundsNeedingAction: 0,
        refundablePayments: 0,
      },
    });
    renderContainer();

    expect(
      screen.getByRole('heading', { name: 'Không còn việc nào chờ xử lý' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Khu quản trị' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Khiếu nại đã lên sàn' })).not.toBeInTheDocument();
  });
});
