import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { LocaleSwitcher } from './LocaleSwitcher';

const { pathname } = vi.hoisted(() => ({ pathname: vi.fn() }));

// Chỉ thay usePathname (next-intl trả đường dẫn ĐÃ bỏ prefix locale) — giữ Link thật để href đúng prefix.
vi.mock('@/i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/navigation')>()),
  usePathname: () => pathname(),
}));

const hrefs = () => ({
  vi: screen.getByRole('button', { name: 'VI' }).getAttribute('href'),
  en: screen.getByRole('button', { name: 'EN' }).getAttribute('href'),
});

describe('LocaleSwitcher', () => {
  beforeEach(() => {
    pathname.mockReset();
  });

  // Nút VI render `/vi/...` chứ không phải URL không prefix: next-intl tự rút gọn bằng 307 ở middleware
  // (i18n/routing.test.ts, Playwright). Đó là cơ chế đã chốt ở rules/frontend.md mục 6.
  it('không truyền query: mỗi nút trỏ đúng prefix của ngôn ngữ đó trên cùng trang', () => {
    pathname.mockReturnValue('/products');
    render(withIntl(<LocaleSwitcher />));

    expect(hrefs()).toEqual({ vi: '/vi/products', en: '/en/products' });
  });

  it('truyền query: GIỮ query khi đổi ngôn ngữ (?next= của /login, ?token= của /reset-password)', () => {
    pathname.mockReturnValue('/login');
    render(withIntl(<LocaleSwitcher query={{ next: '/orders?tab=pending' }} />));

    expect(hrefs()).toEqual({
      vi: '/vi/login?next=%2Forders%3Ftab%3Dpending',
      en: '/en/login?next=%2Forders%3Ftab%3Dpending',
    });
  });

  it('giữ token đặt lại mật khẩu nguyên vẹn qua cả hai ngôn ngữ', () => {
    pathname.mockReturnValue('/reset-password');
    const token = 'a'.repeat(64);
    render(withIntl(<LocaleSwitcher query={{ token }} />));

    expect(hrefs()).toEqual({
      vi: `/vi/reset-password?token=${token}`,
      en: `/en/reset-password?token=${token}`,
    });
  });

  it('query rỗng coi như không có query (không để lại dấu ? thừa)', () => {
    pathname.mockReturnValue('/forgot-password');
    render(withIntl(<LocaleSwitcher query={{}} />));

    expect(hrefs()).toEqual({ vi: '/vi/forgot-password', en: '/en/forgot-password' });
  });

  it('đang ở bản en: nút VI trỏ /vi/... (middleware rút gọn về URL không prefix), nút EN ở lại /en', () => {
    pathname.mockReturnValue('/login');
    render(withIntl(<LocaleSwitcher query={{ next: '/orders' }} />, 'en'));

    expect(hrefs()).toEqual({
      vi: '/vi/login?next=%2Forders',
      en: '/en/login?next=%2Forders',
    });
  });
});
