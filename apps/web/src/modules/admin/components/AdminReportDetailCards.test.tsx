import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { makeResolvedProductReport, makeResolvedShopReport } from '../admin-report.fixtures';
import type { AdminReport } from '../types';
import { AdminReportTargetCard } from './AdminReportDetailCards';

afterEach(() => cleanup());

function setup(report: AdminReport, isRestored?: boolean) {
  render(withIntl(<AdminReportTargetCard report={report} isRestored={isRestored} />));
}

// Hợp đồng của prop `isRestored` (Week11.md 5.7): chỉ đổi câu nhãn của SẢN PHẨM đã bị gỡ vừa được khôi phục về nháp. Container chỉ truyền
// `true` cho báo cáo sản phẩm nên các ca dưới đây khoá riêng thẻ: cờ này không được làm đổi nhãn của loại khác.
describe('AdminReportTargetCard — nhãn khi đối tượng đã mất trang công khai', () => {
  it('sản phẩm đã gỡ: nhãn "đã bị gỡ"; vừa khôi phục (isRestored) ⇒ nhãn "đã khôi phục về nháp"', () => {
    setup(makeResolvedProductReport());
    expect(screen.getByText('Sản phẩm đã bị gỡ — không còn trang công khai')).toBeInTheDocument();

    cleanup();
    setup(makeResolvedProductReport(), true);
    expect(screen.getByText('Đã khôi phục về nháp — chưa hiển thị công khai')).toBeInTheDocument();
    expect(
      screen.queryByText('Sản phẩm đã bị gỡ — không còn trang công khai'),
    ).not.toBeInTheDocument();
  });

  it('shop đã khoá: nhãn "shop đã bị khoá" kèm đường tới quản lý shop, kể cả khi cờ isRestored bị bật nhầm', () => {
    setup(makeResolvedShopReport(), true);

    expect(screen.getByText('Shop đã bị khoá — không còn trang công khai')).toBeInTheDocument();
    expect(
      screen.queryByText('Đã khôi phục về nháp — chưa hiển thị công khai'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mở trong quản lý shop' })).toHaveAttribute(
      'href',
      '/admin/shops?status=SUSPENDED',
    );
  });
});
