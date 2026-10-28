import { SHOP_CASCADE_SUSPEND_REASON } from '@ecommerce/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { AdminShop } from '../types';
import { AdminShopRow } from './AdminShopRow';

const SHOP: AdminShop = {
  id: 'shop-1',
  ownerId: 'user-1',
  name: 'Shop Thời Trang ABC',
  slug: 'shop-thoi-trang-abc',
  logoUrl: null,
  bannerUrl: null,
  description: null,
  status: 'PENDING',
  statusReason: null,
  statusChangedAt: '2026-10-01T12:00:00.000Z',
  lastRejectionReason: null,
  resubmissionCount: 0,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  owner: { name: 'Nguyễn Văn A', email: 'nguyenvana@example.com' },
};

function renderRow(shop: Partial<AdminShop> = {}, actions?: React.ReactNode) {
  return render(
    withIntl(
      <ul>
        <AdminShopRow shop={{ ...SHOP, ...shop }} actions={actions} />
      </ul>,
    ),
  );
}

describe('AdminShopRow', () => {
  it('hiện shop (tên, slug), chủ shop (tên + email), ngày tạo và trạng thái', () => {
    renderRow();

    expect(screen.getByRole('heading', { name: 'Shop Thời Trang ABC' })).toBeInTheDocument();
    expect(screen.getByText('/shop-thoi-trang-abc')).toBeInTheDocument();
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(screen.getByText('nguyenvana@example.com')).toBeInTheDocument();
    expect(screen.getByText('Chờ duyệt')).toBeInTheDocument();
    const time = screen.getByText(/2026/);
    expect(time.tagName).toBe('TIME');
    // Cột ngày hiện mốc VÀO trạng thái hiện tại (statusChangedAt), không phải ngày tạo shop.
    expect(time).toHaveAttribute('datetime', '2026-10-01T12:00:00.000Z');
  });

  it('mỗi trường có nhãn (hiện ở mobile, `lg:sr-only` ở desktop để vẫn có trong cây trợ năng)', () => {
    renderRow();

    for (const label of ['Chủ shop', 'Chờ từ', 'Trạng thái']) {
      const element = screen.getByText(label);
      expect(element).toHaveClass('lg:sr-only');
      expect(element).not.toHaveClass('hidden');
    }
  });

  it('có lý do (từ chối/khoá) -> hiện "Lý do: …" kèm đủ nội dung ở title', () => {
    renderRow({ status: 'SUSPENDED', statusReason: 'Bán hàng cấm' });

    const reason = screen.getByText('Lý do: Bán hàng cấm');
    expect(reason).toHaveAttribute('title', 'Bán hàng cấm');
    expect(screen.getByText('Đã khoá')).toBeInTheDocument();
  });

  it('không có lý do -> không có dòng "Lý do"', () => {
    renderRow();

    expect(screen.queryByText(/^Lý do:/)).not.toBeInTheDocument();
  });

  it('chuỗi do chủ shop nhập chứa HTML hiện nguyên dạng text, không chèn thẻ vào trang', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const { container } = renderRow({
      name: payload,
      statusReason: payload,
      status: 'REJECTED',
      owner: { name: payload, email: 'a@b.c' },
    });

    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getAllByText(payload, { exact: false }).length).toBeGreaterThan(0);
  });

  it('nút hành động do Container truyền vào được vẽ trong dòng', () => {
    renderRow({}, <button type="button">Duyệt</button>);

    expect(screen.getByRole('button', { name: 'Duyệt' })).toBeInTheDocument();
  });

  it('ô thao tác có `empty:hidden` để shop không còn hành động nào không chiếm chỗ', () => {
    const { container } = renderRow({ status: 'REJECTED' });

    const cells = container.querySelectorAll('li > div');
    expect(cells[cells.length - 1]).toHaveClass('empty:hidden');
    expect(cells[cells.length - 1]).toBeEmptyDOMElement();
  });

  it('ô thao tác là cột flex để cụm nút giãn đủ bề rộng cột, không căn phải/giữa theo nội dung', () => {
    const { container } = renderRow({}, <div data-testid="actions" />);

    const cells = container.querySelectorAll('li > div');
    const last = cells[cells.length - 1];
    expect(last).toHaveClass('flex', 'flex-col');
    expect(last).not.toHaveClass('lg:justify-end');
    expect(last).not.toHaveClass('items-center');
  });

  it('logo: có URL -> thẻ img; không có -> không có img (biểu tượng thay thế)', () => {
    const { container, unmount } = renderRow({ logoUrl: 'https://cdn.example.com/l.png' });
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/l.png');
    unmount();

    const second = renderRow({ logoUrl: null });
    expect(second.container.querySelector('img')).toBeNull();
  });

  describe('cột ngày = mốc vào trạng thái hiện tại (statusChangedAt)', () => {
    it.each<[AdminShop['status'], string]>([
      ['PENDING', 'Chờ từ'],
      ['APPROVED', 'Duyệt lúc'],
      ['REJECTED', 'Từ chối lúc'],
      ['SUSPENDED', 'Khoá lúc'],
    ])('shop %s: nhãn "%s"', (status, label) => {
      renderRow({ status });

      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('hiện statusChangedAt, KHÔNG phải createdAt; ngày tạo shop nằm ở tooltip', () => {
      renderRow({
        createdAt: '2026-01-05T12:00:00.000Z',
        statusChangedAt: '2026-10-03T12:00:00.000Z',
      });

      const time = screen.getByText(/2026/);
      expect(time).toHaveAttribute('datetime', '2026-10-03T12:00:00.000Z');
      expect(time.getAttribute('title')).toMatch(/^Shop tạo ngày .*2026/);
      expect(time.getAttribute('title')).toMatch(/thg 1/); // tháng 1 = createdAt, không phải tháng 10
    });
  });

  describe('shop NỘP LẠI (đang ở hàng chờ nhưng từng bị từ chối)', () => {
    it('hiện lý do từ chối lần trước và số lần đã gửi lại', () => {
      renderRow({
        status: 'PENDING',
        lastRejectionReason: 'Thiếu giấy phép kinh doanh',
        resubmissionCount: 2,
      });

      expect(
        screen.getByText('Lý do từ chối lần trước: Thiếu giấy phép kinh doanh'),
      ).toBeInTheDocument();
      expect(screen.getByText('Đã gửi lại 2 lần')).toBeInTheDocument();
    });

    it('lý do dài kẹp 2 dòng, đủ nội dung ở title', () => {
      const reason = 'a'.repeat(300);
      renderRow({ status: 'PENDING', lastRejectionReason: reason, resubmissionCount: 1 });

      const line = screen.getByText(`Lý do từ chối lần trước: ${reason}`);
      expect(line).toHaveClass('line-clamp-2');
      expect(line).toHaveAttribute('title', reason);
    });

    it('lý do từ chối chứa HTML hiện nguyên dạng text, không chèn thẻ', () => {
      const payload = '<img src=x onerror=alert(1)>';
      const { container } = renderRow({
        status: 'PENDING',
        lastRejectionReason: payload,
        resubmissionCount: 1,
      });

      expect(container.querySelector('img[src="x"]')).toBeNull();
      expect(screen.getByText(`Lý do từ chối lần trước: ${payload}`)).toBeInTheDocument();
    });

    it('shop chưa từng bị từ chối (hàng chờ lần đầu): không có dòng lý do lần trước lẫn "Đã gửi lại"', () => {
      renderRow({ status: 'PENDING', lastRejectionReason: null, resubmissionCount: 0 });

      expect(screen.queryByText(/Lý do từ chối lần trước/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Đã gửi lại/)).not.toBeInTheDocument();
    });

    it('đã từng bị từ chối nhưng CHƯA nộp lại lần nào (count 0): vẫn hiện lý do lần trước, không hiện "Đã gửi lại 0 lần"', () => {
      renderRow({
        status: 'PENDING',
        lastRejectionReason: 'Thiếu giấy phép',
        resubmissionCount: 0,
      });

      expect(screen.getByText('Lý do từ chối lần trước: Thiếu giấy phép')).toBeInTheDocument();
      expect(screen.queryByText(/Đã gửi lại/)).not.toBeInTheDocument();
    });
  });

  describe('shop đang REJECTED / các trạng thái khác', () => {
    it('REJECTED: chỉ hiện lý do HIỆN TẠI một lần (không lặp lại thành "lần trước"), vẫn hiện số lần đã gửi lại', () => {
      renderRow({
        status: 'REJECTED',
        statusReason: 'Ảnh logo mờ',
        lastRejectionReason: 'Ảnh logo mờ',
        resubmissionCount: 1,
      });

      expect(screen.getByText('Lý do: Ảnh logo mờ')).toBeInTheDocument();
      expect(screen.queryByText(/Lý do từ chối lần trước/)).not.toBeInTheDocument();
      expect(screen.getByText('Đã gửi lại 1 lần')).toBeInTheDocument();
    });

    it.each<AdminShop['status']>(['APPROVED', 'SUSPENDED'])(
      '%s: dù từng bị từ chối cũng không hiện lý do lần trước / số lần gửi lại (không làm ồn tab khác)',
      (status) => {
        renderRow({ status, lastRejectionReason: 'Cũ', resubmissionCount: 3 });

        expect(screen.queryByText(/Lý do từ chối lần trước/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Đã gửi lại/)).not.toBeInTheDocument();
      },
    );
  });

  it('shop bị TỰ ĐỘNG tạm ngừng vì chủ tài khoản bị khoá/cấm: mã SHOP_CASCADE_SUSPEND_REASON được dịch, mã thô không bao giờ hiện', () => {
    renderRow({ status: 'SUSPENDED', statusReason: SHOP_CASCADE_SUSPEND_REASON });

    expect(screen.getByText('Lý do: tài khoản chủ shop bị khoá hoặc bị cấm')).toBeInTheDocument();
    expect(screen.queryByText(/OWNER_ACCOUNT_SUSPENDED/)).not.toBeInTheDocument();
  });

  it('bản tiếng Anh của lý do tự động: không lộ tiếng Việt, không lộ mã thô', () => {
    render(
      withIntl(
        <ul>
          <AdminShopRow
            shop={{ ...SHOP, status: 'SUSPENDED', statusReason: SHOP_CASCADE_SUSPEND_REASON }}
          />
        </ul>,
        'en',
      ),
    );

    expect(
      screen.getByText('Reason: the owner’s account is suspended or banned'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/OWNER_ACCOUNT_SUSPENDED|tài khoản/)).not.toBeInTheDocument();
  });

  it('lý do Admin tự nhập vẫn hiện nguyên văn (không bị nhầm với mã tự động)', () => {
    renderRow({ status: 'SUSPENDED', statusReason: 'Bán hàng cấm' });

    expect(screen.getByText('Lý do: Bán hàng cấm')).toBeInTheDocument();
  });
});

describe('AdminShopRow — sửa lỗi hiển thị (Week11.md 4.5)', () => {
  const LONG_UNBROKEN = 'x'.repeat(500);

  it('dòng 1: lý do (và lý do bị từ chối lần trước) dùng overflow-wrap:anywhere — break-words không thu nhỏ min-content nên chuỗi không dấu cách làm thẻ rộng ra', () => {
    renderRow({ status: 'SUSPENDED', statusReason: LONG_UNBROKEN });
    const reason = screen.getByText(`Lý do: ${LONG_UNBROKEN}`);
    expect(reason).toHaveClass('[overflow-wrap:anywhere]', 'line-clamp-2');
    expect(reason).not.toHaveClass('break-words');
  });

  it('dòng 1: cùng cách xử lý cho lý do từ chối lần trước của shop nộp lại', () => {
    renderRow({ status: 'PENDING', lastRejectionReason: LONG_UNBROKEN });
    const previous = screen.getByText(/Lý do từ chối lần trước/);
    expect(previous).toHaveClass('[overflow-wrap:anywhere]');
    expect(previous).not.toHaveClass('break-words');
  });

  it('dòng 7: chữ bị cắt (tên shop, slug, tên và email chủ shop) mang bản đầy đủ ở title', () => {
    renderRow({ name: 'Shop Của Tài Khoản Bị Khoá Rất Dài' });

    expect(
      screen.getByRole('heading', { name: 'Shop Của Tài Khoản Bị Khoá Rất Dài' }),
    ).toHaveAttribute('title', 'Shop Của Tài Khoản Bị Khoá Rất Dài');
    expect(screen.getByText('/shop-thoi-trang-abc')).toHaveAttribute(
      'title',
      '/shop-thoi-trang-abc',
    );
    expect(screen.getByText('Nguyễn Văn A')).toHaveAttribute('title', 'Nguyễn Văn A');
    expect(screen.getByText('nguyenvana@example.com')).toHaveAttribute(
      'title',
      'nguyenvana@example.com',
    );
  });

  it('dòng 8: thẻ (dưới lg) có 2 cột — Chủ shop cạnh Ngày; shop, trạng thái và thao tác chiếm cả hàng; từ lg mỗi ô một cột của bảng', () => {
    const { container } = renderRow({}, <button type="button">Duyệt</button>);

    const row = container.querySelector('li');
    expect(row).toHaveClass('grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]');
    const cells = Array.from(row?.children ?? []);
    expect(cells).toHaveLength(5);
    const [shop, owner, date, status, actions] = cells;
    for (const cell of [shop, status, actions]) {
      expect(cell).toHaveClass('col-span-2', 'lg:col-span-1');
    }
    for (const cell of [owner, date]) {
      expect(cell).not.toHaveClass('col-span-2');
    }
  });
});
