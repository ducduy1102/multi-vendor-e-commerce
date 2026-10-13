import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ADMIN_REFUND_TABS } from '../admin-refunds-href';
import { ADMIN_REFUND_GRID_CLASS } from './admin-refund-row.constants';
import { ADMIN_REFUND_COLUMN_KEYS, AdminRefundListHeader } from './AdminRefundListHeader';

describe('AdminRefundListHeader', () => {
  it.each([
    ['disputes', ['Yêu cầu', 'Đơn hàng', 'Trạng thái', 'Thao tác']],
    ['failed', ['Khoản hoàn', 'Thanh toán', 'Trạng thái', 'Thao tác']],
    ['payments', ['Thanh toán', 'Các đơn của lần đặt', 'Vì sao bất thường', 'Thao tác']],
  ] as const)('tab %s: đủ 4 cột đúng nhãn của bảng đó', (tab, labels) => {
    const { container } = render(withIntl(<AdminRefundListHeader tab={tab} />));

    expect(container.firstElementChild?.children).toHaveLength(4);
    for (const label of labels) expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('aria-hidden (mỗi ô của dòng dữ liệu đã có nhãn riêng cho trình đọc màn hình)', () => {
    const { container } = render(withIntl(<AdminRefundListHeader tab="disputes" />));

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('chỉ hiện từ md (dưới đó mỗi dòng tự có nhãn), dùng đúng template cột của dòng dữ liệu, cột cuối căn phải', () => {
    const { container } = render(withIntl(<AdminRefundListHeader tab="disputes" />));

    const header = container.firstElementChild as HTMLElement;
    expect(header).toHaveClass('hidden', 'md:grid');
    for (const cls of ADMIN_REFUND_GRID_CLASS.split(' ').filter((c) =>
      c.startsWith('md:grid-cols'),
    )) {
      expect(header).toHaveClass(cls);
    }
    expect(header.lastElementChild).toHaveClass('md:text-right');
  });

  it('mọi tab đều có đúng 4 nhãn cột (khớp lưới 4 cột)', () => {
    for (const tab of ADMIN_REFUND_TABS) expect(ADMIN_REFUND_COLUMN_KEYS[tab]).toHaveLength(4);
  });
});
