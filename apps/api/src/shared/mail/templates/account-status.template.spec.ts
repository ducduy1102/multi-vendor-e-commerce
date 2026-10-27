import type { MailLocale } from '../mail-locale';
import type {
  AccountStatusEmailData,
  AccountStatusEmailKind,
} from './account-email.types';
import { accountStatusTemplate } from './account-status.template';

// Email báo chủ tài khoản khi Admin khoá / cấm / mở lại (Week11.md 3.3). Song ngữ chung của mọi template (đúng ngôn ngữ, link
// đúng prefix) nằm ở locale-templates.spec.ts; ở đây khoá những gì RIÊNG của email này: lý do và tên là văn bản người ta nhập
// nên luôn bị escape, email khoá KHÔNG có nút / link nào, dòng hỗ trợ chỉ có khi cấu hình và chỉ ở email khoá.
const KINDS: AccountStatusEmailKind[] = ['SUSPENDED', 'BANNED', 'REACTIVATED'];
const LOCALES: MailLocale[] = ['vi', 'en'];
const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(2)>';

function build(
  kind: AccountStatusEmailKind,
  locale: MailLocale,
  overrides: Partial<AccountStatusEmailData> = {},
) {
  return accountStatusTemplate({
    locale,
    name: 'John',
    kind,
    reason: 'Policy violation',
    supportEmail: null,
    loginUrl:
      locale === 'vi'
        ? 'https://app.example.com/login'
        : 'https://app.example.com/en/login',
    ...overrides,
  });
}

describe('accountStatusTemplate', () => {
  describe.each(LOCALES)('%s', (locale) => {
    it.each(KINDS)('%s: có tiêu đề riêng, tên người nhận và lý do', (kind) => {
      const { subject, html } = build(kind, locale, {
        reason: 'Dùng tài khoản giả',
      });

      expect(subject.trim().length).toBeGreaterThan(0);
      expect(html).toContain('John');
      expect(html).toContain('Dùng tài khoản giả');
    });

    it('ba loại có ba tiêu đề khác nhau', () => {
      const subjects = KINDS.map((kind) => build(kind, locale).subject);

      expect(new Set(subjects).size).toBe(3);
    });

    it.each(['SUSPENDED', 'BANNED'] as const)(
      '%s: KHÔNG có nút hay link nào (người bị khoá không đăng nhập được)',
      (kind) => {
        const { html } = build(kind, locale);

        expect(html).not.toMatch(/href=/i);
        expect(html).not.toContain('<a ');
      },
    );

    it('REACTIVATED: có đúng một nút trỏ tới trang đăng nhập đúng ngôn ngữ', () => {
      const { html } = build('REACTIVATED', locale);
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

      expect(hrefs).toEqual([
        locale === 'vi'
          ? 'https://app.example.com/login'
          : 'https://app.example.com/en/login',
      ]);
    });
  });

  describe('dòng liên hệ hỗ trợ', () => {
    it.each(LOCALES)(
      '%s: email khoá / cấm hiện dòng hỗ trợ khi có cấu hình, và là văn bản thuần (không thành link)',
      (locale) => {
        for (const kind of ['SUSPENDED', 'BANNED'] as const) {
          const { html } = build(kind, locale, {
            supportEmail: 'help@example.com',
          });

          expect(html).toContain('help@example.com');
          expect(html).not.toMatch(/href=/i);
        }
      },
    );

    it.each(KINDS)(
      '%s: không cấu hình ⇒ không có dòng hỗ trợ nào (vi lẫn en)',
      (kind) => {
        for (const locale of LOCALES) {
          const { html } = build(kind, locale, { supportEmail: null });

          expect(html).not.toContain('@');
          expect(html).not.toMatch(/Liên hệ hỗ trợ|Contact support/);
        }
      },
    );

    it('email mở lại KHÔNG hiện dòng hỗ trợ dù có cấu hình (chỉ email khoá cần đường phản hồi)', () => {
      const { html } = build('REACTIVATED', 'vi', {
        supportEmail: 'help@example.com',
      });

      expect(html).not.toContain('help@example.com');
    });

    it('địa chỉ hỗ trợ cũng bị escape', () => {
      const { html } = build('SUSPENDED', 'en', {
        supportEmail: `"><script>x</script>@evil.test`,
      });

      expect(html).not.toContain('<script>');
    });
  });

  describe.each(LOCALES)('chống chèn HTML (%s)', (locale) => {
    it.each(KINDS)('%s: tên người nhận và LÝ DO bị escape', (kind) => {
      const { html, subject } = build(kind, locale, {
        name: HOSTILE,
        reason: HOSTILE,
      });

      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;script&gt;');
      // Tiêu đề thư không chứa dữ liệu người nhập.
      expect(subject).not.toContain('<');
    });
  });

  it('lý do nhiều dòng giữ xuống dòng bằng CSS (white-space:pre-line), không chèn thẻ <br> thô', () => {
    const { html } = build('SUSPENDED', 'vi', { reason: 'Dòng 1\nDòng 2' });

    expect(html).toContain('white-space:pre-line');
    expect(html).toContain('Dòng 1\nDòng 2');
    expect(html).not.toContain('<br');
  });
});
