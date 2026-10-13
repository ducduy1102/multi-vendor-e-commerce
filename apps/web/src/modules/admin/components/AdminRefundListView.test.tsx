import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { AdminRefundsPageQuery } from '../admin-refunds-href';
import { AdminRefundListView } from './AdminRefundListView';

interface Item {
  id: string;
  label: string;
}

const QUERY: AdminRefundsPageQuery = { tab: 'failed', status: 'FAILED', page: 1 };

function setup({
  data,
  isPending = false,
  pageQuery = QUERY,
}: {
  data?: { items: Item[]; total: number; limit: number };
  isPending?: boolean;
  pageQuery?: AdminRefundsPageQuery;
}) {
  const onReload = vi.fn();
  const utils = render(
    withIntl(
      <AdminRefundListView<Item>
        tab="failed"
        pageQuery={pageQuery}
        data={data}
        isPending={isPending}
        onReload={onReload}
        emptyMessage="Không có gì ở bộ lọc này"
        renderRow={(item) => <li>{item.label}</li>}
      />,
    ),
  );
  return { ...utils, onReload };
}

describe('AdminRefundListView', () => {
  it('đang tải (chưa có dữ liệu): vùng aria-busy kèm dòng sr-only, skeleton trang trí khớp bảng thật', () => {
    const { container } = setup({ isPending: true });

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Đang tải...')).toHaveClass('sr-only');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(container).toHaveTextContent('Khoản hoàn');
  });

  it('lỗi tải lần đầu: thông báo role=alert + nút "Thử lại" gọi onReload; không có danh sách', async () => {
    const user = userEvent.setup();
    const { onReload } = setup({ isPending: false });

    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh sách');
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('rỗng: câu theo bộ lọc, không có bảng và không có phân trang', () => {
    setup({ data: { items: [], total: 0, limit: 20 } });

    expect(screen.getByText('Không có gì ở bộ lọc này')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('có dữ liệu: bảng có tiêu đề cột (aria-hidden) + danh sách có nhãn truy cập + đủ dòng do renderRow dựng', () => {
    setup({
      data: {
        items: [
          { id: 'a', label: 'Dòng A' },
          { id: 'b', label: 'Dòng B' },
        ],
        total: 2,
        limit: 20,
      },
    });

    const list = screen.getByRole('list', { name: 'Danh sách khoản hoàn tiền' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Dòng A', 'Dòng B']);
    expect(screen.getByText('Thanh toán')).toBeInTheDocument();
  });

  it('có dữ liệu thì LUÔN hiện dữ liệu, kể cả khi isPending/refetch đang chạy (không xoá danh sách đang xem)', () => {
    setup({
      data: { items: [{ id: 'a', label: 'Dòng A' }], total: 1, limit: 20 },
      isPending: true,
    });

    expect(screen.getByText('Dòng A')).toBeInTheDocument();
    expect(screen.queryByText('Đang tải...')).not.toBeInTheDocument();
  });

  it('nhiều trang: phân trang "Trang x / y", link GIỮ tab + bộ lọc đang xem', () => {
    setup({
      data: { items: [{ id: 'a', label: 'Dòng A' }], total: 45, limit: 20 },
      pageQuery: { ...QUERY, page: 2 },
    });

    expect(screen.getByText('Trang 2 / 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trang trước' })).toHaveAttribute(
      'href',
      '/admin/refunds?tab=failed&status=FAILED',
    );
    expect(screen.getByRole('link', { name: 'Trang sau' })).toHaveAttribute(
      'href',
      '/admin/refunds?tab=failed&status=FAILED&page=3',
    );
  });

  it('một trang duy nhất: không có phân trang', () => {
    setup({ data: { items: [{ id: 'a', label: 'Dòng A' }], total: 1, limit: 20 } });

    expect(screen.queryByRole('link', { name: 'Trang sau' })).not.toBeInTheDocument();
  });
});
