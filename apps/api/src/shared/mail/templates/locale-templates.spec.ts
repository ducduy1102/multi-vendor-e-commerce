import { frontendUrl } from '../frontend-url';
import type { MailLocale } from '../mail-locale';
import type {
  AccountStatusEmailData,
  PasswordChangedEmailData,
  PasswordResetEmailData,
  ShopStatusEmailData,
  ShopStatusEmailKind,
} from './account-email.types';
import { accountStatusTemplate } from './account-status.template';
import type {
  OrderCancelledEmailData,
  OrderCompletedEmailData,
  OrderConfirmedEmailData,
  OrderEmailOrder,
  OrderPlacedEmailData,
  OrderRefundedEmailData,
  OrderShippedEmailData,
  RefundRequestRejectedEmailData,
} from './order-email.types';
import { orderCancelledTemplate } from './order-cancelled.template';
import { orderCompletedTemplate } from './order-completed.template';
import { orderConfirmedTemplate } from './order-confirmed.template';
import { orderPlacedTemplate } from './order-placed.template';
import { orderRefundedTemplate } from './order-refunded.template';
import { orderShippedTemplate } from './order-shipped.template';
import { passwordChangedTemplate } from './password-changed.template';
import { passwordResetTemplate } from './password-reset.template';
import { refundRequestRejectedTemplate } from './refund-request-rejected.template';
import { shopStatusTemplate } from './shop-status.template';
import { verifyEmailTemplate } from './verify-email.template';

// Song ngữ vi/en của MỌI template email (Week9.md 1.12/5.3): đúng ngôn ngữ, đúng link, và mọi giá trị người
// nhập đều bị escape ở cả hai ngôn ngữ. Không snapshot nguyên khối HTML — chỉ kiểm cụm chính.

const LOCALES: MailLocale[] = ['vi', 'en'];

// Chữ cái có dấu CHỈ tiếng Việt mới dùng. Dữ liệu fixture bên dưới cố ý toàn ASCII để cụm này chỉ có thể
// đến từ chính bản dịch của template.
const VIETNAMESE_LETTERS =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

const ORDER: OrderEmailOrder = {
  orderCode: 'AB12CD34',
  shopName: 'Shop A',
  items: [
    {
      productName: 'T-shirt',
      variantLabel: 'Red / M',
      quantity: 2,
      unitPrice: 150_000,
    },
  ],
  shippingFee: 20_000,
  discountAmount: 10_000,
  totalAmount: 310_000,
};

function ordersUrl(locale: MailLocale): string {
  return frontendUrl('/orders/o1', locale);
}

// Mỗi mục: tên + hàm dựng email theo locale, dùng dữ liệu ASCII.
const BUILDERS: Array<
  [string, (locale: MailLocale) => { subject: string; html: string }]
> = [
  [
    'verify-email',
    (locale) =>
      verifyEmailTemplate(
        'John',
        frontendUrl('/verify-email?token=abc', locale),
        locale,
      ),
  ],
  [
    'order-placed',
    (locale) =>
      orderPlacedTemplate({
        locale,
        buyerName: 'John',
        ordersUrl: ordersUrl(locale),
        orders: [ORDER],
        paymentMethod: 'COD',
        recipient: { name: 'John', phone: '0900000000', address: '1 Main St' },
      } satisfies OrderPlacedEmailData),
  ],
  [
    'order-placed (online)',
    (locale) =>
      orderPlacedTemplate({
        locale,
        buyerName: 'John',
        ordersUrl: ordersUrl(locale),
        orders: [ORDER],
        paymentMethod: 'VNPAY',
        recipient: { name: 'John', phone: '0900000000', address: '1 Main St' },
      } satisfies OrderPlacedEmailData),
  ],
  [
    'order-confirmed',
    (locale) =>
      orderConfirmedTemplate({
        locale,
        buyerName: 'John',
        ordersUrl: ordersUrl(locale),
        order: ORDER,
      } satisfies OrderConfirmedEmailData),
  ],
  [
    'order-shipped',
    (locale) =>
      orderShippedTemplate({
        locale,
        buyerName: 'John',
        ordersUrl: ordersUrl(locale),
        order: ORDER,
        carrier: 'GHN',
        trackingCode: 'T123',
      } satisfies OrderShippedEmailData),
  ],
  ...(['SELLER', 'BUYER', 'SYSTEM', 'ADMIN'] as const).map(
    (cancelledBy) =>
      [
        `order-cancelled (${cancelledBy})`,
        (locale: MailLocale) =>
          orderCancelledTemplate({
            locale,
            buyerName: 'John',
            ordersUrl: ordersUrl(locale),
            orders: [ORDER],
            cancelledBy,
            reason: 'Out of stock',
            refundAmount: 310_000,
          } satisfies OrderCancelledEmailData),
      ] as [string, (locale: MailLocale) => { subject: string; html: string }],
  ),
  ...(['ORIGINAL_PAYMENT', 'SHOP_CASH'] as const).map(
    (refundTo) =>
      [
        `order-refunded (${refundTo})`,
        (locale: MailLocale) =>
          orderRefundedTemplate({
            locale,
            buyerName: 'John',
            ordersUrl: ordersUrl(locale),
            order: ORDER,
            refundAmount: 310_000,
            refundTo,
          } satisfies OrderRefundedEmailData),
      ] as [string, (locale: MailLocale) => { subject: string; html: string }],
  ),
  ...(['BUYER', 'SYSTEM'] as const).flatMap((completedBy) =>
    [true, false].map(
      (invitesReview) =>
        [
          `order-completed (${completedBy}, mời đánh giá=${invitesReview})`,
          (locale: MailLocale) =>
            orderCompletedTemplate({
              locale,
              buyerName: 'John',
              ordersUrl: ordersUrl(locale),
              order: ORDER,
              completedBy,
              autoCompleteDays: 7,
              returnWindowDays: 7,
              invitesReview,
            } satisfies OrderCompletedEmailData),
        ] as [
          string,
          (locale: MailLocale) => { subject: string; html: string },
        ],
    ),
  ),
  ...(['SELLER', 'ADMIN'] as const).flatMap((rejectedBy) =>
    (['CANCEL', 'RETURN'] as const).map(
      (kind) =>
        [
          `refund-request-rejected (${rejectedBy}, ${kind})`,
          (locale: MailLocale) =>
            refundRequestRejectedTemplate({
              locale,
              buyerName: 'John',
              ordersUrl: ordersUrl(locale),
              order: ORDER,
              kind,
              rejectedBy,
              reason: 'Out of stock',
              escalateDays: rejectedBy === 'SELLER' ? 3 : null,
            } satisfies RefundRequestRejectedEmailData),
        ] as [
          string,
          (locale: MailLocale) => { subject: string; html: string },
        ],
    ),
  ),
  [
    'password-reset',
    (locale) =>
      passwordResetTemplate({
        locale,
        name: 'John',
        resetUrl: frontendUrl('/reset-password?token=abc', locale),
        expiresInMinutes: 60,
      } satisfies PasswordResetEmailData),
  ],
  [
    'password-changed',
    (locale) =>
      passwordChangedTemplate({
        locale,
        name: 'John',
        forgotPasswordUrl: frontendUrl('/forgot-password', locale),
      } satisfies PasswordChangedEmailData),
  ],
  ...(['SUSPENDED', 'BANNED', 'REACTIVATED'] as const).map(
    (kind) =>
      [
        `account-status (${kind})`,
        (locale: MailLocale) =>
          accountStatusTemplate({
            locale,
            name: 'John',
            kind,
            reason: 'Policy violation',
            supportEmail: null,
            loginUrl: frontendUrl('/login', locale),
            shopNotice: null,
          } satisfies AccountStatusEmailData),
      ] as [string, (locale: MailLocale) => { subject: string; html: string }],
  ),
  // Cùng ba loại email nhưng kèm câu nói thêm về SHOP của người nhận (Week11.md 3.4): khoá ⇒ shop tạm ngừng, mở lại ⇒ shop
  // được mở lại, mở lại từ bị cấm ⇒ shop vẫn bị khoá.
  ...(
    [
      ['SUSPENDED', 'SUSPENDED'],
      ['BANNED', 'SUSPENDED'],
      ['REACTIVATED', 'REOPENED'],
      ['REACTIVATED', 'STILL_SUSPENDED'],
    ] as const
  ).map(
    ([kind, shopNotice]) =>
      [
        `account-status (${kind}, shop ${shopNotice})`,
        (locale: MailLocale) =>
          accountStatusTemplate({
            locale,
            name: 'John',
            kind,
            reason: 'Policy violation',
            supportEmail: null,
            loginUrl: frontendUrl('/login', locale),
            shopNotice,
          } satisfies AccountStatusEmailData),
      ] as [string, (locale: MailLocale) => { subject: string; html: string }],
  ),
  ...(['APPROVED', 'REJECTED', 'SUSPENDED', 'REINSTATED'] as const).map(
    (kind) =>
      [
        `shop-status (${kind})`,
        (locale: MailLocale) =>
          shopStatusTemplate({
            locale,
            ownerName: 'John',
            shopName: 'Shop A',
            kind,
            reason:
              kind === 'REJECTED' || kind === 'SUSPENDED'
                ? 'Missing documents'
                : null,
            shopUrl: frontendUrl('/seller/shop', locale),
            // Có địa chỉ hỗ trợ để các kiểm tra chung bên dưới chạy cả trên nhánh có dòng liên hệ.
            supportEmail: 'support@example.com',
          } satisfies ShopStatusEmailData),
      ] as [string, (locale: MailLocale) => { subject: string; html: string }],
  ),
];

describe('frontendUrl', () => {
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.example.com';
  });
  afterEach(() => {
    delete process.env.FRONTEND_URL;
  });

  it('vi: không có prefix (localePrefix as-needed của FE)', () => {
    expect(frontendUrl('/orders/o1', 'vi')).toBe(
      'https://app.example.com/orders/o1',
    );
  });

  it('en: có prefix /en', () => {
    expect(frontendUrl('/orders/o1', 'en')).toBe(
      'https://app.example.com/en/orders/o1',
    );
  });

  // Week10.md 2.3: dùng cho cả redirect về trang chủ sau Google OAuth — `/en/` sẽ bị Next.js 308 về `/en`.
  it('trang chủ "/": vi = chính base, en = base/en (không có dấu / thừa)', () => {
    expect(frontendUrl('/', 'vi')).toBe('https://app.example.com');
    expect(frontendUrl('/', 'en')).toBe('https://app.example.com/en');
    process.env.FRONTEND_URL = 'https://app.example.com///';
    expect(frontendUrl('/', 'en')).toBe('https://app.example.com/en');
  });

  it('path dạng "/?x=1" không bị coi là trang chủ trần (giữ nguyên query)', () => {
    expect(frontendUrl('/?x=1', 'en')).toBe('https://app.example.com/en/?x=1');
  });

  it('giữ nguyên query, chịu được base có dấu / cuối và path thiếu dấu / đầu', () => {
    process.env.FRONTEND_URL = 'https://app.example.com///';
    expect(frontendUrl('verify-email?token=a%2Fb', 'en')).toBe(
      'https://app.example.com/en/verify-email?token=a%2Fb',
    );
  });

  it('không đặt FRONTEND_URL: dùng mặc định localhost:3000; chuỗi rỗng cũng rơi về mặc định', () => {
    delete process.env.FRONTEND_URL;
    expect(frontendUrl('/cart', 'vi')).toBe('http://localhost:3000/cart');
    process.env.FRONTEND_URL = '   ';
    expect(frontendUrl('/cart', 'en')).toBe('http://localhost:3000/en/cart');
  });
});

describe('mọi template × mọi ngôn ngữ', () => {
  it.each(BUILDERS)(
    '%s: có tiêu đề và nội dung ở cả vi và en',
    (_name, build) => {
      for (const locale of LOCALES) {
        const { subject, html } = build(locale);
        expect(subject.trim().length).toBeGreaterThan(0);
        expect(html.trim().length).toBeGreaterThan(0);
      }
    },
  );

  it.each(BUILDERS)(
    '%s: bản vi là tiếng Việt, bản en KHÔNG lẫn chữ tiếng Việt nào (kể cả footer, nhãn, nút)',
    (_name, build) => {
      const vi = build('vi');
      const en = build('en');

      expect(`${vi.subject} ${vi.html}`).toMatch(VIETNAMESE_LETTERS);
      expect(en.subject).not.toMatch(VIETNAMESE_LETTERS);
      expect(en.html).not.toMatch(VIETNAMESE_LETTERS);
      // Hai bản không được trùng nhau (bản dịch thật chứ không phải cùng một chuỗi).
      expect(en.subject).not.toBe(vi.subject);
    },
  );

  // Không nhánh nào được để lọt chỗ giữ chỗ chưa thay (`{name}`) hay giá trị rỗng bị in ra chữ (`undefined`, `null`, `NaN`,
  // `[object Object]`) — lỗi này chỉ lộ ra ở nhánh ít chạy (vd người hủy là Admin, có/không có dòng hỗ trợ).
  it.each(BUILDERS)(
    '%s: không còn {placeholder} hay giá trị rỗng bị in ra chữ ở cả vi và en',
    (_name, build) => {
      for (const locale of LOCALES) {
        const { subject, html } = build(locale);
        for (const text of [subject, html]) {
          expect(text).not.toMatch(/\{[A-Za-z_]\w*\}/);
          expect(text).not.toMatch(/\bundefined\b|\bnull\b|\bNaN\b|\[object /);
        }
      }
    },
  );

  // Email khoá / cấm tài khoản CỐ Ý không có nút hay link (người nhận không đăng nhập được, Week11.md 3.3). Khai tường minh
  // thay vì nới điều kiện "có ít nhất một link" cho mọi template: template khác mất nút sẽ vẫn làm test đỏ.
  const LINKLESS = new Set([
    'account-status (SUSPENDED)',
    'account-status (BANNED)',
    'account-status (SUSPENDED, shop SUSPENDED)',
    'account-status (BANNED, shop SUSPENDED)',
  ]);

  it.each(BUILDERS)(
    '%s: link trong email có đúng prefix ngôn ngữ (vi: không /en, en: /en)',
    (name, build) => {
      const hrefs = (html: string) =>
        [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

      const viLinks = hrefs(build('vi').html);
      const enLinks = hrefs(build('en').html);

      if (LINKLESS.has(name)) {
        expect(viLinks).toEqual([]);
        expect(enLinks).toEqual([]);
        return;
      }
      expect(viLinks.length).toBeGreaterThan(0);
      expect(enLinks.length).toBeGreaterThan(0);
      for (const link of viLinks) expect(link).not.toContain('/en/');
      for (const link of enLinks) expect(link).toContain('/en/');
    },
  );
});

describe('chống chèn HTML ở mọi ngôn ngữ', () => {
  it.each(LOCALES)(
    'order-completed và refund-request-rejected (%s): tên người nhận, tên shop, tên sản phẩm và LÝ DO bị escape',
    (locale) => {
      const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>';
      const evilOrder: OrderEmailOrder = {
        ...ORDER,
        shopName: hostile,
        items: [{ ...ORDER.items[0], productName: hostile }],
      };
      const outputs = [
        orderCompletedTemplate({
          locale,
          buyerName: hostile,
          ordersUrl: ordersUrl(locale),
          order: evilOrder,
          completedBy: 'SYSTEM',
          autoCompleteDays: 7,
          returnWindowDays: 7,
          invitesReview: true,
        }).html,
        refundRequestRejectedTemplate({
          locale,
          buyerName: hostile,
          ordersUrl: ordersUrl(locale),
          order: evilOrder,
          kind: 'CANCEL',
          rejectedBy: 'SELLER',
          reason: hostile,
          escalateDays: 3,
        }).html,
      ];

      for (const html of outputs) {
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      }
    },
  );

  const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&';

  function expectEscaped(html: string) {
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  }

  it.each(LOCALES)(
    'password-reset (%s): tên người nhận bị escape',
    (locale) => {
      const { html } = passwordResetTemplate({
        locale,
        name: HOSTILE,
        resetUrl: frontendUrl('/reset-password?token=abc', locale),
        expiresInMinutes: 60,
      });
      expectEscaped(html);
    },
  );

  it.each(LOCALES)(
    'password-reset (%s): URL có ký tự lạ không thoát khỏi thuộc tính href',
    (locale) => {
      const { html } = passwordResetTemplate({
        locale,
        name: 'John',
        resetUrl:
          'https://app.example.com/reset-password?token=a&next="><script>x()</script>',
        expiresInMinutes: 60,
      });
      expect(html).not.toContain('<script>');
      expect(html).toContain('token=a&amp;next=&quot;&gt;&lt;script&gt;');
    },
  );

  it.each(LOCALES)(
    'password-changed (%s): tên người nhận bị escape',
    (locale) => {
      const { html } = passwordChangedTemplate({
        locale,
        name: HOSTILE,
        forgotPasswordUrl: frontendUrl('/forgot-password', locale),
      });
      expectEscaped(html);
    },
  );

  it.each(LOCALES)(
    'shop-status (%s): tên chủ shop, tên shop và LÝ DO của Admin đều bị escape',
    (locale) => {
      const { html } = shopStatusTemplate({
        locale,
        ownerName: HOSTILE,
        shopName: HOSTILE,
        kind: 'REJECTED',
        reason: HOSTILE,
        shopUrl: frontendUrl('/seller/shop', locale),
        supportEmail: null,
      });
      expectEscaped(html);
      // Ba chỗ chèn (tên chủ, tên shop, lý do) ⇒ ba lần xuất hiện đã escape.
      expect(html.split('&lt;script&gt;').length - 1).toBe(3);
    },
  );

  it.each(LOCALES)(
    'order-refunded (%s): tên buyer, tên shop, tên sản phẩm bị escape',
    (locale) => {
      const { html } = orderRefundedTemplate({
        locale,
        buyerName: HOSTILE,
        ordersUrl: ordersUrl(locale),
        order: {
          ...ORDER,
          shopName: HOSTILE,
          items: [
            {
              productName: HOSTILE,
              variantLabel: HOSTILE,
              quantity: 1,
              unitPrice: 1000,
            },
          ],
        },
        refundAmount: 1000,
        refundTo: 'ORIGINAL_PAYMENT',
      });
      expectEscaped(html);
    },
  );

  it.each(LOCALES)(
    'verify-email (%s): tên bị escape, link xác thực là <a> duy nhất',
    (locale) => {
      const { html } = verifyEmailTemplate(
        HOSTILE,
        frontendUrl('/verify-email?token=abc', locale),
        locale,
      );
      expectEscaped(html);
      expect((html.match(/<a /g) ?? []).length).toBe(1);
    },
  );
});

describe('password-reset', () => {
  const data = (locale: MailLocale): PasswordResetEmailData => ({
    locale,
    name: 'John',
    resetUrl: frontendUrl('/reset-password?token=tok123', locale),
    expiresInMinutes: 60,
  });

  it('vi: nêu hạn dùng bằng phút, có nút và link dự phòng dạng chữ, dặn bỏ qua nếu không yêu cầu', () => {
    const { subject, html } = passwordResetTemplate(data('vi'));

    expect(subject).toBe('Đặt lại mật khẩu của bạn');
    expect(html).toContain('hết hạn sau 60 phút');
    expect(html).toContain('Đặt lại mật khẩu</a>');
    expect(html).toContain('sao chép liên kết');
    expect(html).toContain('http://localhost:3000/reset-password?token=tok123');
    expect(html).toContain('hãy bỏ qua email này');
  });

  it('en: dùng số ít/số nhiều đúng cho phút', () => {
    expect(
      passwordResetTemplate({ ...data('en'), expiresInMinutes: 60 }).html,
    ).toContain('expires in 60 minutes');
    expect(
      passwordResetTemplate({ ...data('en'), expiresInMinutes: 1 }).html,
    ).toContain('expires in 1 minute ');
  });

  it('en: link có prefix /en', () => {
    expect(passwordResetTemplate(data('en')).html).toContain(
      'http://localhost:3000/en/reset-password?token=tok123',
    );
  });
});

describe('password-changed', () => {
  it('KHÔNG chứa mật khẩu hay token, chỉ có link tới trang quên mật khẩu', () => {
    const { html } = passwordChangedTemplate({
      locale: 'vi',
      name: 'John',
      forgotPasswordUrl: frontendUrl('/forgot-password', 'vi'),
    });

    expect(html).not.toMatch(/token/i);
    expect(html).toContain('http://localhost:3000/forgot-password');
    expect(html).toContain('Nếu không phải bạn');
  });
});

describe('shop-status', () => {
  const base = (
    locale: MailLocale,
    kind: ShopStatusEmailKind,
    reason: string | null,
    supportEmail: string | null = null,
  ): ShopStatusEmailData => ({
    locale,
    ownerName: 'John',
    shopName: 'Shop A',
    kind,
    reason,
    shopUrl: frontendUrl('/seller/shop', locale),
    supportEmail,
  });

  it.each([
    ['APPROVED', 'Shop Shop A đã được duyệt'],
    ['REJECTED', 'Shop Shop A chưa được duyệt'],
    ['SUSPENDED', 'Shop Shop A đã bị tạm khoá'],
    ['REINSTATED', 'Shop Shop A đã được mở khoá'],
  ] as const)('vi %s: tiêu đề nêu tên shop', (kind, subject) => {
    expect(shopStatusTemplate(base('vi', kind, null)).subject).toBe(subject);
  });

  it.each([
    ['APPROVED', 'Your shop Shop A has been approved'],
    ['REJECTED', 'Your shop Shop A was not approved'],
    ['SUSPENDED', 'Your shop Shop A has been suspended'],
    ['REINSTATED', 'Your shop Shop A has been reinstated'],
  ] as const)('en %s: tiêu đề nêu tên shop', (kind, subject) => {
    expect(shopStatusTemplate(base('en', kind, null)).subject).toBe(subject);
  });

  it('từ chối/khoá: hiện lý do kèm câu hướng dẫn tiếp theo', () => {
    const rejected = shopStatusTemplate(
      base('vi', 'REJECTED', 'Thiếu giấy tờ'),
    ).html;
    expect(rejected).toContain('Lý do:</strong> Thiếu giấy tờ');
    expect(rejected).toContain('gửi duyệt lại');

    const suspended = shopStatusTemplate(
      base('en', 'SUSPENDED', 'Policy violation'),
    ).html;
    expect(suspended).toContain('Reason:</strong> Policy violation');
  });

  it('duyệt/mở khoá: không có dòng lý do', () => {
    expect(shopStatusTemplate(base('vi', 'APPROVED', null)).html).not.toContain(
      'Lý do',
    );
    expect(
      shopStatusTemplate(base('en', 'REINSTATED', null)).html,
    ).not.toContain('Reason');
  });

  describe('dòng liên hệ hỗ trợ (Week11.md 4.2)', () => {
    const SUPPORT = 'support@example.com';

    it.each(['REJECTED', 'SUSPENDED'] as const)(
      '%s có địa chỉ hỗ trợ: vi hiện "Liên hệ hỗ trợ", en hiện "Contact support", đúng địa chỉ',
      (kind) => {
        const vi = shopStatusTemplate(base('vi', kind, 'Lý do', SUPPORT)).html;
        const en = shopStatusTemplate(base('en', kind, 'Reason', SUPPORT)).html;

        expect(vi).toContain(`Liên hệ hỗ trợ:</strong> ${SUPPORT}`);
        expect(en).toContain(`Contact support:</strong> ${SUPPORT}`);
      },
    );

    it.each(['REJECTED', 'SUSPENDED'] as const)(
      '%s không đặt địa chỉ hỗ trợ (null) ⇒ không có dòng liên hệ nào',
      (kind) => {
        for (const locale of ['vi', 'en'] as const) {
          const { html } = shopStatusTemplate(base(locale, kind, 'x', null));
          expect(html).not.toContain('Liên hệ hỗ trợ');
          expect(html).not.toContain('Contact support');
        }
      },
    );

    it.each(['APPROVED', 'REINSTATED'] as const)(
      '%s là tin vui: dù có địa chỉ hỗ trợ cũng không hiện dòng liên hệ',
      (kind) => {
        for (const locale of ['vi', 'en'] as const) {
          const { html } = shopStatusTemplate(
            base(locale, kind, null, SUPPORT),
          );
          expect(html).not.toContain(SUPPORT);
          expect(html).not.toContain('Liên hệ hỗ trợ');
          expect(html).not.toContain('Contact support');
        }
      },
    );

    it('địa chỉ hỗ trợ bị escape như mọi chuỗi chèn vào email', () => {
      const { html } = shopStatusTemplate(
        base('vi', 'SUSPENDED', 'x', '<script>alert(1)</script>'),
      );

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  it('vi: có link tới trang quản lý shop không prefix; en: có /en', () => {
    expect(shopStatusTemplate(base('vi', 'APPROVED', null)).html).toContain(
      'href="http://localhost:3000/seller/shop"',
    );
    expect(shopStatusTemplate(base('en', 'APPROVED', null)).html).toContain(
      'href="http://localhost:3000/en/seller/shop"',
    );
  });
});

describe('order-refunded', () => {
  const data = (
    locale: MailLocale,
    refundTo: OrderRefundedEmailData['refundTo'],
  ): OrderRefundedEmailData => ({
    locale,
    buyerName: 'John',
    ordersUrl: ordersUrl(locale),
    order: ORDER,
    refundAmount: 310_000,
    refundTo,
  });

  it('đơn đã trả online: nói ĐANG hoàn về phương thức ban đầu kèm số tiền, không nói shop hoàn tiền mặt', () => {
    const { html } = orderRefundedTemplate(data('vi', 'ORIGINAL_PAYMENT'));
    const text = html.replace(/\s/g, ' ');

    expect(text).toContain(
      'đang hoàn 310.000 ₫ về phương thức thanh toán ban đầu',
    );
    expect(html).not.toContain('tiền mặt');
  });

  it('đơn COD: shop hoàn tiền mặt, hệ thống không theo dõi', () => {
    const { html } = orderRefundedTemplate(data('vi', 'SHOP_CASH'));

    expect(html).toContain('thanh toán khi nhận hàng');
    expect(html).toContain('tiền mặt');
    expect(html).toContain('liên hệ shop');
    expect(html).not.toContain('phương thức thanh toán ban đầu');
  });

  it('en: cả hai nhánh có nội dung riêng', () => {
    const online = orderRefundedTemplate(data('en', 'ORIGINAL_PAYMENT')).html;
    const cod = orderRefundedTemplate(data('en', 'SHOP_CASH')).html;

    expect(online).toContain('original payment method');
    expect(cod).toContain('paid on delivery');
    expect(cod).toContain('in cash');
  });
});
