import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ReportEntry } from './ReportEntry';

const auth = { user: null as { id: string } | null, isHydrating: false };
const reportButton = vi.fn();

vi.mock('@/i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/navigation')>()),
  usePathname: () => '/products/ao-thun',
}));
vi.mock('@/modules/auth', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}));
// Mã báo cáo chỉ được nạp bằng import() động khi đã đăng nhập: mock barrel để thấy khi nào nó được dùng.
vi.mock('@/modules/report', () => ({
  ReportButton: (props: unknown) => {
    reportButton(props);
    return <button type="button">report-button</button>;
  },
}));

const REVIEW_ID = '11111111-1111-4111-8111-111111111111';

function setup(props: Partial<React.ComponentProps<typeof ReportEntry>> = {}) {
  return render(withIntl(<ReportEntry targetType="REVIEW" targetId={REVIEW_ID} {...props} />));
}

describe('ReportEntry (composition root của nút "Báo cáo")', () => {
  beforeEach(() => {
    auth.user = null;
    auth.isHydrating = false;
    reportButton.mockReset();
  });

  it('đang chờ xác định phiên: skeleton, CHƯA có link đăng nhập lẫn nút (không nháy rồi đổi)', () => {
    auth.isHydrating = true;
    const { container } = setup();

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="skeleton"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(reportButton).not.toHaveBeenCalled();
  });

  it('khách vãng lai: LINK /login?next=<trang hiện tại> với nhãn "Báo cáo"; mã báo cáo KHÔNG được nạp', async () => {
    setup();

    const link = screen.getByRole('link', { name: 'Báo cáo' });
    expect(link).toHaveAttribute('href', '/login?next=%2Fproducts%2Fao-thun');
    // Nhường một nhịp cho import() động (nếu có lỗi nạp nhầm) rồi mới khẳng định phủ định.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reportButton).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'report-button' })).not.toBeInTheDocument();
  });

  it('đã đăng nhập: nạp động nút báo cáo và truyền đúng đối tượng + kiểu nút', async () => {
    auth.user = { id: 'u1' };
    setup({ targetType: 'CONVERSATION', variant: 'outline', className: 'extra' });

    expect(await screen.findByRole('button', { name: 'report-button' })).toBeInTheDocument();
    expect(reportButton).toHaveBeenCalledWith({
      targetType: 'CONVERSATION',
      targetId: REVIEW_ID,
      variant: 'outline',
      className: 'extra',
    });
    expect(screen.queryByRole('link', { name: 'Báo cáo' })).not.toBeInTheDocument();
  });

  it('kiểu nút mặc định là ghost', async () => {
    auth.user = { id: 'u1' };
    setup();

    await screen.findByRole('button', { name: 'report-button' });
    expect(reportButton).toHaveBeenCalledWith(expect.objectContaining({ variant: 'ghost' }));
  });

  it('tiếng Anh: link khách có nhãn "Report"', () => {
    render(withIntl(<ReportEntry targetType="SHOP" targetId={REVIEW_ID} />, 'en'));

    expect(screen.getByRole('link', { name: 'Report' })).toBeInTheDocument();
  });
});
