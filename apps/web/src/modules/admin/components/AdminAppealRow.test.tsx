import { SHOP_CASCADE_SUSPEND_REASON } from '@ecommerce/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { makeAppeal, makeProductAppeal } from '../admin-appeal.fixtures';
import type { AdminAppeal } from '../types';
import { AdminAppealRow } from './AdminAppealRow';

afterEach(() => {
  cleanup();
});

function renderRow(
  overrides: Partial<AdminAppeal> = {},
  actions?: React.ReactNode,
  locale: 'vi' | 'en' = 'vi',
) {
  return render(
    withIntl(
      <ul>
        <AdminAppealRow appeal={makeAppeal(overrides)} actions={actions} />
      </ul>,
      locale,
    ),
  );
}

describe('AdminAppealRow — kháng nghị đang chờ', () => {
  it('hiện shop (tên), chủ shop (tên + email), lời kháng nghị, lý do đã khoá shop, ngày gửi và trạng thái', () => {
    renderRow();

    expect(screen.getByRole('heading', { name: 'Shop Thời Trang ABC' })).toBeInTheDocument();
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(screen.getByText('nguyenvana@example.com')).toBeInTheDocument();
    expect(
      screen.getByText('Shop đã gỡ các sản phẩm bị báo cáo và bổ sung giấy tờ nguồn gốc.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Lý do khoá: Bán hàng giả')).toBeInTheDocument();
    expect(screen.getByText('Chờ xử lý')).toBeInTheDocument();
    const time = screen.getByText(/2026/);
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-10-29T08:00:00.000Z');
  });

  it('mỗi trường có nhãn (hiện ở mobile, `lg:sr-only` ở desktop để vẫn có trong cây trợ năng)', () => {
    renderRow();

    for (const label of ['Lời kháng nghị', 'Gửi lúc', 'Trạng thái']) {
      const element = screen.getByText(label);
      expect(element).toHaveClass('lg:sr-only');
      expect(element).not.toHaveClass('hidden');
    }
  });

  it('chưa có kết quả: không có ghi chú, người quyết định, giờ quyết định hay lời giải thích "đã đóng"', () => {
    renderRow();

    expect(screen.queryByText(/^Ghi chú:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Bởi /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Quyết định lúc /)).not.toBeInTheDocument();
    expect(screen.queryByText(/không còn gì để xử lý/)).not.toBeInTheDocument();
  });

  it('chữ bị cắt đều có title mang bản đầy đủ (lời kháng nghị kẹp 3 dòng, lý do khoá kẹp 2 dòng, email cắt đuôi)', () => {
    const message = 'Nội dung rất dài '.repeat(40).trim();
    renderRow({
      message,
      shop: { ...makeAppeal().shop, statusReason: 'Lý do khoá rất dài '.repeat(10).trim() },
    });

    const messageElement = screen.getByText(message);
    expect(messageElement).toHaveAttribute('title', message);
    expect(messageElement).toHaveClass('line-clamp-3');
    const reason = screen.getByText(/^Lý do khoá: Lý do khoá rất dài/);
    expect(reason).toHaveAttribute('title', 'Lý do khoá rất dài '.repeat(10).trim());
    expect(reason).toHaveClass('line-clamp-2');
    expect(screen.getByText('nguyenvana@example.com')).toHaveAttribute(
      'title',
      'nguyenvana@example.com',
    );
  });

  it('văn bản người dùng nhập hiện dạng text (không thành HTML) và bẻ chuỗi dài không dấu cách', () => {
    const hostile = `<img src=x onerror=alert(1)>${'a'.repeat(300)}`;
    renderRow({ message: hostile });

    expect(document.querySelector('img')).toBeNull();
    const message = screen.getByText(hostile);
    expect(message).toHaveClass('[overflow-wrap:anywhere]');
    expect(message).toHaveClass('whitespace-pre-line');
  });

  it('mã lý do khoá theo cascade tài khoản được dịch thành câu, mã thô không bao giờ hiện', () => {
    renderRow({ shop: { ...makeAppeal().shop, statusReason: SHOP_CASCADE_SUSPEND_REASON } });

    expect(screen.getByText('Lý do: tài khoản chủ shop bị khoá hoặc bị cấm')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain(SHOP_CASCADE_SUSPEND_REASON);
  });

  it('shop không có lý do khoá (null) thì không vẽ dòng lý do', () => {
    renderRow({ shop: { ...makeAppeal().shop, statusReason: null } });

    expect(screen.queryByText(/^Lý do/)).not.toBeInTheDocument();
  });

  it('hành động do Container truyền vào được vẽ ở ô cuối', () => {
    renderRow({}, <button type="button">Nút thử</button>);

    expect(screen.getByRole('button', { name: 'Nút thử' })).toBeInTheDocument();
  });

  it('không có hành động: ô cuối rỗng và `empty:hidden` (không chiếm chỗ ở thẻ mobile)', () => {
    const { container } = renderRow();

    const cells = container.querySelectorAll('li > div');
    const last = cells[cells.length - 1];
    expect(last).toBeEmptyDOMElement();
    expect(last).toHaveClass('empty:hidden');
  });
});

describe('AdminAppealRow — đã có kết quả', () => {
  it('bị từ chối: huy hiệu, ghi chú, người quyết định và giờ quyết định', () => {
    renderRow({
      state: 'REJECTED',
      decisionNote: 'Giấy tờ chưa hợp lệ',
      decidedByName: 'Quản trị viên An',
      decidedAt: '2026-10-29T09:30:00.000Z',
    });

    expect(screen.getByText('Đã từ chối')).toBeInTheDocument();
    expect(screen.getByText('Ghi chú: Giấy tờ chưa hợp lệ')).toBeInTheDocument();
    expect(screen.getByText('Bởi Quản trị viên An')).toBeInTheDocument();
    expect(screen.getByText(/^Quyết định lúc /)).toBeInTheDocument();
  });

  it('ghi chú dài kẹp 2 dòng và có title đầy đủ', () => {
    const note = 'Ghi chú dài '.repeat(30).trim();
    renderRow({ state: 'REJECTED', decisionNote: note });

    const element = screen.getByText(`Ghi chú: ${note}`);
    expect(element).toHaveAttribute('title', note);
    expect(element).toHaveClass('line-clamp-2');
  });

  it('đã chấp nhận: huy hiệu "Đã chấp nhận"; ghi chú tuỳ chọn nên có thể vắng', () => {
    renderRow({ state: 'ACCEPTED', decidedByName: 'Quản trị viên An' });

    expect(screen.getByText('Đã chấp nhận')).toBeInTheDocument();
    expect(screen.queryByText(/^Ghi chú:/)).not.toBeInTheDocument();
  });

  it('Admin đã bị xoá (decidedByName null): không vẽ dòng "Bởi"', () => {
    renderRow({ state: 'ACCEPTED', decidedByName: null });

    expect(screen.queryByText(/^Bởi /)).not.toBeInTheDocument();
  });

  it('đã đóng: huy hiệu "Đã đóng" kèm lời giải thích lần khoá đã kết thúc', () => {
    renderRow({ state: 'CLOSED' });

    expect(screen.getByText('Đã đóng')).toBeInTheDocument();
    expect(
      screen.getByText('Lần khoá này đã kết thúc, không còn gì để xử lý.'),
    ).toBeInTheDocument();
  });
});

describe('AdminAppealRow — tiếng Anh', () => {
  it('không lẫn chuỗi tiếng Việt do mẫu dịch (chỉ chữ người dùng nhập được giữ nguyên)', () => {
    renderRow(
      {
        state: 'REJECTED',
        message: 'We removed the items.',
        decisionNote: 'Documents are invalid.',
        decidedByName: 'Admin An',
        decidedAt: '2026-10-29T09:30:00.000Z',
        shop: { ...makeAppeal().shop, name: 'Shop ABC', statusReason: 'Counterfeit goods' },
        owner: { name: 'Owner A', email: 'owner@example.com' },
      },
      undefined,
      'en',
    );

    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Suspension reason: Counterfeit goods')).toBeInTheDocument();
    expect(screen.getByText('Note: Documents are invalid.')).toBeInTheDocument();
    const vietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    expect(document.body.textContent ?? '').not.toMatch(vietnamese);
  });
});

// Kháng nghị của SẢN PHẨM bị gỡ (Week11.md 5.8): chung bảng với kháng nghị shop.
describe('AdminAppealRow — kháng nghị sản phẩm bị gỡ', () => {
  function renderProductRow(
    overrides: Partial<AdminAppeal> = {},
    actions?: React.ReactNode,
    locale: 'vi' | 'en' = 'vi',
  ) {
    return render(
      withIntl(
        <ul>
          <AdminAppealRow appeal={makeProductAppeal(overrides)} actions={actions} />
        </ul>,
        locale,
      ),
    );
  }

  it('đối tượng là SẢN PHẨM: nhãn loại "Sản phẩm", tên sản phẩm là tiêu đề, kèm tên shop và email chủ shop', () => {
    renderProductRow();

    expect(screen.getByRole('heading', { name: 'Dao bấm tự động' })).toBeInTheDocument();
    expect(screen.getByText('Sản phẩm')).toBeInTheDocument();
    expect(screen.getByText('Của shop Shop Thời Trang ABC')).toBeInTheDocument();
    expect(screen.getByText('nguyenvana@example.com')).toBeInTheDocument();
    // Tên chủ shop không còn là dòng riêng (dòng đó dành cho tên shop), email vẫn để Admin liên hệ.
    expect(screen.queryByText('Nguyễn Văn A')).not.toBeInTheDocument();
  });

  it('nhãn loại đứng RIÊNG một dòng phía trên tên (cạnh tên thì ở cột hẹp tên sản phẩm chỉ còn vài ký tự): tên có cả bề rộng cột để cắt bằng truncate', () => {
    renderProductRow();

    const badge = screen.getByText('Sản phẩm', { exact: true });
    const heading = screen.getByRole('heading', { name: 'Dao bấm tự động' });
    expect(badge.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Cùng cột dọc với tiêu đề, nhưng KHÔNG chung hàng ngang với nó.
    expect(badge.parentElement).toBe(heading.parentElement);
    expect(badge).toHaveClass('self-start');
    expect(heading.parentElement).toHaveClass('flex-col');
    expect(heading).toHaveClass('truncate');
  });

  it('kháng nghị shop vẫn là dạng cũ: nhãn "Shop", tên shop là tiêu đề, tên chủ shop là dòng riêng', () => {
    renderRow();

    expect(screen.getByText('Shop', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shop Thời Trang ABC' })).toBeInTheDocument();
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(screen.queryByText(/^Của shop/)).not.toBeInTheDocument();
  });

  it('lý do hiện ra là lý do GỠ SẢN PHẨM, kể cả khi shop đang có lý do khoá khác', () => {
    renderProductRow({
      shop: { ...makeProductAppeal().shop, status: 'SUSPENDED', statusReason: 'Bán hàng giả' },
    });

    expect(screen.getByText('Lý do gỡ: Hàng cấm theo quy định của sàn.')).toBeInTheDocument();
    expect(screen.queryByText(/Lý do khoá/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bán hàng giả/)).not.toBeInTheDocument();
  });

  it('lý do gỡ dài bị kẹp 2 dòng nhưng mang bản đầy đủ ở title; chuỗi không dấu cách được bẻ', () => {
    const long = 'x'.repeat(400);
    renderProductRow({
      product: { ...makeProductAppeal().product!, takenDownReason: long },
    });

    const line = screen.getByText(`Lý do gỡ: ${long}`);
    expect(line).toHaveClass('line-clamp-2', '[overflow-wrap:anywhere]');
    expect(line).toHaveAttribute('title', long);
  });

  it('sản phẩm đã khôi phục (không còn lý do gỡ) ⇒ không in dòng lý do rỗng', () => {
    renderProductRow({
      state: 'ACCEPTED',
      product: { ...makeProductAppeal().product!, takenDownReason: null },
    });

    expect(screen.queryByText(/Lý do gỡ/)).not.toBeInTheDocument();
    expect(screen.getByText('Đã chấp nhận')).toBeInTheDocument();
  });

  it('đã đóng: câu giải thích nói về LẦN GỠ (không phải lần khoá)', () => {
    renderProductRow({ state: 'CLOSED' });

    expect(screen.getByText('Lần gỡ này đã kết thúc, không còn gì để xử lý.')).toBeInTheDocument();
    expect(screen.queryByText(/Lần khoá/)).not.toBeInTheDocument();
  });

  it('chữ do người dùng nhập (tên sản phẩm, lời kháng nghị) là text, tên dài được cắt và mang title đầy đủ', () => {
    const hostile = `<img src=x onerror=alert(1)>${'a'.repeat(300)}`;
    renderProductRow({
      message: hostile,
      product: { ...makeProductAppeal().product!, name: hostile },
    });

    expect(document.querySelector('img')).toBeNull();
    const heading = screen.getByRole('heading', { name: hostile });
    expect(heading).toHaveClass('truncate');
    expect(heading).toHaveAttribute('title', hostile);
  });

  it('thiếu khối product (dữ liệu lệch) ⇒ rơi về dạng shop thay vì ném lỗi', () => {
    renderProductRow({ product: null });

    expect(screen.getByRole('heading', { name: 'Shop Thời Trang ABC' })).toBeInTheDocument();
  });

  it('có nút hành động thì hiện trong cột thao tác', () => {
    renderProductRow({}, <button type="button">Chấp nhận</button>);

    expect(screen.getByRole('button', { name: 'Chấp nhận' })).toBeInTheDocument();
  });

  it('tiếng Anh: không lẫn chuỗi tiếng Việt do mẫu dịch (chỉ chữ người dùng nhập được giữ nguyên)', () => {
    renderProductRow(
      {
        message: 'We added proof of origin.',
        shop: { ...makeProductAppeal().shop, name: 'Shop ABC' },
        product: {
          ...makeProductAppeal().product!,
          name: 'Switchblade',
          takenDownReason: 'Prohibited goods.',
        },
        owner: { name: 'Owner A', email: 'owner@example.com' },
      },
      undefined,
      'en',
    );

    expect(screen.getByText('Product')).toBeInTheDocument();
    expect(screen.getByText('From shop Shop ABC')).toBeInTheDocument();
    expect(screen.getByText('Take-down reason: Prohibited goods.')).toBeInTheDocument();
    const vietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    expect(document.body.textContent ?? '').not.toMatch(vietnamese);
  });
});
