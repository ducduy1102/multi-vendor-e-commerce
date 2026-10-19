import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { AuthPageLayout } from './AuthPageLayout';

vi.mock('@/i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/navigation')>()),
  usePathname: () => '/login',
}));

// Các trang xác thực ẩn Header (HIDDEN_CHROME_PATHS) nên không có nút đổi ngôn ngữ nào ở đó — trong khi FE đã
// đặt `localeDetection: false` (Week10.md 2.3) và không còn tự đưa trình duyệt tiếng Anh sang /en.
describe('AuthPageLayout', () => {
  it('có nút đổi ngôn ngữ VI/EN và hiện nội dung trong card', () => {
    render(
      withIntl(
        <AuthPageLayout>
          <h1>Đăng nhập</h1>
        </AuthPageLayout>,
      ),
    );

    expect(screen.getByRole('button', { name: 'VI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'EN' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument();
  });

  it('truyền localeQuery xuống nút đổi ngôn ngữ (giữ ?next= khi đổi)', () => {
    render(
      withIntl(
        <AuthPageLayout localeQuery={{ next: '/checkout' }}>
          <p>nội dung</p>
        </AuthPageLayout>,
      ),
    );

    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute(
      'href',
      '/en/login?next=%2Fcheckout',
    );
  });

  it('nút đổi ngôn ngữ nằm TRƯỚC card trong thứ tự đọc (thứ tự Tab: đổi ngôn ngữ rồi mới tới form)', () => {
    render(
      withIntl(
        <AuthPageLayout>
          <button type="button">trong card</button>
        </AuthPageLayout>,
      ),
    );

    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['VI', 'EN', 'trong card']);
  });
});
