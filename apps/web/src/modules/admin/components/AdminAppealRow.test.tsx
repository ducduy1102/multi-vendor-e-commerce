import { SHOP_CASCADE_SUSPEND_REASON } from '@ecommerce/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { makeAppeal } from '../admin-appeal.fixtures';
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
