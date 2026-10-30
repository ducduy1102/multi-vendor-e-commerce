import { NOTIFICATION_TYPES } from '@ecommerce/types';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import {
  NOTIFICATION_MESSAGE_KEYS,
  describeNotification,
  type NotificationDisplay,
  type NotificationIcon,
} from './notification-display';
import { at, uuid } from './notification-test-data';
import type { Notification } from './types';

const ORDER = uuid(3001);
const SHOP = uuid(2001);
const PRODUCT = uuid(4001);
const BASE = { id: uuid(1), readAt: null, createdAt: at(0) };

interface Case {
  name: string;
  notification: Notification;
  icon: NotificationIcon;
  titleKey: string;
  bodyKey: string;
  href: string | null;
}

// MỘT dòng cho mỗi (loại × biến thể có nhánh riêng: phía nhận, người hủy, loại yêu cầu...). Bảng này là nguồn sự thật
// cho các kiểm tra bên dưới (mọi loại có mặt, mọi khoá dịch được dùng, mọi href đúng).
const CASES: Case[] = [
  {
    name: 'ORDER_NEW',
    notification: { ...BASE, type: 'ORDER_NEW', data: { orderId: ORDER } },
    icon: 'order',
    titleKey: 'titleOrderNew',
    bodyKey: 'bodyOrderNew',
    href: `/seller/orders/${ORDER}`,
  },
  {
    name: 'ORDER_CONFIRMED',
    notification: {
      ...BASE,
      type: 'ORDER_CONFIRMED',
      data: { orderId: ORDER, shopName: 'Shop Áo' },
    },
    icon: 'order',
    titleKey: 'titleOrderConfirmed',
    bodyKey: 'bodyOrderConfirmed',
    href: `/orders/${ORDER}`,
  },
  {
    name: 'ORDER_SHIPPED',
    notification: { ...BASE, type: 'ORDER_SHIPPED', data: { orderId: ORDER, shopName: 'Shop Áo' } },
    icon: 'shipping',
    titleKey: 'titleOrderShipped',
    bodyKey: 'bodyOrderShipped',
    href: `/orders/${ORDER}`,
  },
  ...(['SELLER', 'BUYER', 'SYSTEM', 'ADMIN'] as const).map((by): Case => ({
    name: `ORDER_CANCELLED BUYER by ${by}`,
    notification: {
      ...BASE,
      type: 'ORDER_CANCELLED',
      data: { orderId: ORDER, audience: 'BUYER', by, shopName: 'Shop Áo', reason: 'Hết hàng' },
    },
    icon: 'cancelled',
    titleKey: 'titleOrderCancelled',
    bodyKey: `bodyOrderCancelledBuyerBy${by[0]}${by.slice(1).toLowerCase()}`,
    href: `/orders/${ORDER}`,
  })),
  ...(['BUYER', 'SELLER', 'SYSTEM', 'ADMIN'] as const).map((by): Case => ({
    name: `ORDER_CANCELLED SELLER by ${by}`,
    notification: {
      ...BASE,
      type: 'ORDER_CANCELLED',
      data: { orderId: ORDER, audience: 'SELLER', by, shopName: 'Shop Áo', reason: 'Đổi ý' },
    },
    icon: 'cancelled',
    titleKey: 'titleOrderCancelled',
    bodyKey: `bodyOrderCancelledSellerBy${by[0]}${by.slice(1).toLowerCase()}`,
    href: `/seller/orders/${ORDER}`,
  })),
  {
    name: 'ORDER_COMPLETED',
    notification: {
      ...BASE,
      type: 'ORDER_COMPLETED',
      data: { orderId: ORDER, shopName: 'Shop Áo' },
    },
    icon: 'completed',
    titleKey: 'titleOrderCompleted',
    bodyKey: 'bodyOrderCompleted',
    href: `/orders/${ORDER}`,
  },
  ...(['CANCEL', 'RETURN'] as const).flatMap((kind): Case[] => [
    {
      name: `REFUND_REQUEST_NEW ${kind}`,
      notification: { ...BASE, type: 'REFUND_REQUEST_NEW', data: { orderId: ORDER, kind } },
      icon: 'refund',
      titleKey: 'titleRefundRequestNew',
      bodyKey: 'bodyRefundRequestNew',
      href: '/seller/refund-requests',
    },
    {
      name: `REFUND_REQUEST_APPROVED ${kind}`,
      notification: { ...BASE, type: 'REFUND_REQUEST_APPROVED', data: { orderId: ORDER, kind } },
      icon: 'refund',
      titleKey: 'titleRefundRequestApproved',
      bodyKey: 'bodyRefundRequestApproved',
      href: `/orders/${ORDER}`,
    },
    {
      name: `REFUND_REQUEST_REJECTED ${kind}`,
      notification: {
        ...BASE,
        type: 'REFUND_REQUEST_REJECTED',
        data: { orderId: ORDER, kind, reason: 'Không đủ điều kiện' },
      },
      icon: 'refund',
      titleKey: 'titleRefundRequestRejected',
      bodyKey: 'bodyRefundRequestRejected',
      href: `/orders/${ORDER}`,
    },
  ]),
  {
    name: 'REFUND_REQUEST_ESCALATED ADMIN',
    notification: {
      ...BASE,
      type: 'REFUND_REQUEST_ESCALATED',
      data: { orderId: ORDER, kind: 'RETURN', audience: 'ADMIN' },
    },
    icon: 'refund',
    titleKey: 'titleRefundRequestEscalated',
    bodyKey: 'bodyRefundRequestEscalatedAdmin',
    href: '/admin/refunds',
  },
  {
    name: 'REFUND_REQUEST_ESCALATED SELLER',
    notification: {
      ...BASE,
      type: 'REFUND_REQUEST_ESCALATED',
      data: { orderId: ORDER, kind: 'CANCEL', audience: 'SELLER' },
    },
    icon: 'refund',
    titleKey: 'titleRefundRequestEscalated',
    bodyKey: 'bodyRefundRequestEscalatedSeller',
    href: '/seller/refund-requests',
  },
  ...(['APPROVED', 'REJECTED'] as const).map((outcome): Case => ({
    name: `REFUND_REQUEST_DECIDED_BY_ADMIN ${outcome}`,
    notification: {
      ...BASE,
      type: 'REFUND_REQUEST_DECIDED_BY_ADMIN',
      data: { orderId: ORDER, kind: 'RETURN', outcome },
    },
    icon: 'refund',
    titleKey: 'titleRefundDecidedByAdmin',
    bodyKey: 'bodyRefundDecidedByAdmin',
    href: '/seller/refund-requests',
  })),
  {
    name: 'REFUND_COMPLETED',
    notification: { ...BASE, type: 'REFUND_COMPLETED', data: { orderId: ORDER } },
    icon: 'refund',
    titleKey: 'titleRefundCompleted',
    bodyKey: 'bodyRefundCompleted',
    href: `/orders/${ORDER}`,
  },
  {
    name: 'REVIEW_NEW',
    notification: {
      ...BASE,
      type: 'REVIEW_NEW',
      data: { productId: PRODUCT, productName: 'Áo thun', rating: 4 },
    },
    icon: 'review',
    titleKey: 'titleReviewNew',
    bodyKey: 'bodyReviewNew',
    href: '/seller/reviews',
  },
  {
    name: 'REVIEW_REPLIED',
    notification: {
      ...BASE,
      type: 'REVIEW_REPLIED',
      data: { productId: PRODUCT, productName: 'Áo thun', shopName: 'Shop Áo' },
    },
    icon: 'review',
    titleKey: 'titleReviewReplied',
    bodyKey: 'bodyReviewReplied',
    href: `/products/${PRODUCT}`,
  },
  ...(['APPROVED', 'REJECTED', 'SUSPENDED', 'PENDING'] as const).map((status): Case => ({
    name: `SHOP_STATUS_CHANGED ${status}`,
    notification: {
      ...BASE,
      type: 'SHOP_STATUS_CHANGED',
      data: { shopId: SHOP, status, reason: 'Thiếu giấy phép' },
    },
    icon: 'shop',
    titleKey: 'titleShopStatusChanged',
    bodyKey: 'bodyShopStatusChanged',
    href: '/seller/shop',
  })),
  {
    name: 'ADMIN_SHOP_PENDING',
    notification: {
      ...BASE,
      type: 'ADMIN_SHOP_PENDING',
      data: { shopId: SHOP, shopName: 'Shop Mới' },
    },
    icon: 'shop',
    titleKey: 'titleAdminShopPending',
    bodyKey: 'bodyAdminShopPending',
    href: '/admin/shops',
  },
  {
    name: 'ADMIN_APPEAL_PENDING',
    notification: {
      ...BASE,
      type: 'ADMIN_APPEAL_PENDING',
      data: { appealId: ORDER, shopId: SHOP, shopName: 'Shop Bị Khóa' },
    },
    icon: 'shop',
    titleKey: 'titleAdminAppealPending',
    bodyKey: 'bodyAdminAppealPending',
    href: '/admin/appeals',
  },
  ...(['ACCEPTED', 'REJECTED'] as const).map((decision): Case => ({
    name: `APPEAL_DECIDED ${decision}`,
    notification: {
      ...BASE,
      type: 'APPEAL_DECIDED',
      data: { appealId: ORDER, shopId: SHOP, decision },
    },
    icon: 'shop',
    titleKey: decision === 'ACCEPTED' ? 'titleAppealAccepted' : 'titleAppealRejected',
    bodyKey: decision === 'ACCEPTED' ? 'bodyAppealAccepted' : 'bodyAppealRejected',
    href: '/seller/shop',
  })),
  ...(
    [
      ['REVIEW', 'bodyReportNewReview'],
      ['CONVERSATION', 'bodyReportNewConversation'],
      ['SHOP', 'bodyReportNewShop'],
      ['PRODUCT', 'bodyReportNewProduct'],
    ] as const
  ).map(([targetType, bodyKey]): Case => ({
    name: `REPORT_NEW ${targetType}`,
    notification: {
      ...BASE,
      type: 'REPORT_NEW',
      data: { reportId: ORDER, targetType },
    },
    icon: 'info',
    titleKey: 'titleReportNew',
    bodyKey,
    href: '/admin/reports',
  })),
  ...(['RESOLVED', 'DISMISSED'] as const).map((outcome): Case => ({
    name: `REPORT_RESOLVED ${outcome}`,
    notification: {
      ...BASE,
      type: 'REPORT_RESOLVED',
      data: { reportId: ORDER, targetType: 'REVIEW', outcome },
    },
    icon: 'info',
    titleKey: 'titleReportResolved',
    bodyKey: outcome === 'RESOLVED' ? 'bodyReportResolved' : 'bodyReportDismissed',
    href: null,
  })),
  {
    name: 'UNKNOWN',
    notification: { ...BASE, type: 'UNKNOWN', data: {} },
    icon: 'info',
    titleKey: 'titleUnknown',
    bodyKey: 'bodyUnknown',
    href: null,
  },
];

const translator = (locale: 'vi' | 'en') =>
  createTranslator({
    locale,
    messages: locale === 'vi' ? viMessages : enMessages,
    namespace: 'notification',
  }) as unknown as (key: string, params?: Record<string, string | number>) => string;

const render = (display: NotificationDisplay, locale: 'vi' | 'en') => {
  const t = translator(locale);
  return { title: t(display.titleKey, display.params), body: t(display.bodyKey, display.params) };
};

describe('describeNotification — bảng ánh xạ', () => {
  it.each(CASES)('$name ⇒ icon, khoá dịch và đường dẫn đúng', (c) => {
    const display = describeNotification(c.notification);

    expect(display.icon).toBe(c.icon);
    expect(display.titleKey).toBe(c.titleKey);
    expect(display.bodyKey).toBe(c.bodyKey);
    expect(display.href).toBe(c.href);
  });

  it('bảng phủ MỌI loại thông báo của BE (và loại lạ UNKNOWN) — thêm loại mới mà quên ở đây thì đỏ', () => {
    const covered = new Set(CASES.map((c) => c.notification.type));

    expect(covered).toEqual(new Set([...NOTIFICATION_TYPES, 'UNKNOWN']));
  });

  it('icon luôn thuộc tập icon đã khai', () => {
    const icons: NotificationIcon[] = [
      'order',
      'shipping',
      'cancelled',
      'completed',
      'refund',
      'review',
      'shop',
      'info',
    ];
    for (const c of CASES) expect(icons).toContain(describeNotification(c.notification).icon);
  });
});

describe('khoá dịch', () => {
  it('mọi khoá được dùng đều có trong NOTIFICATION_MESSAGE_KEYS', () => {
    const used = new Set(
      CASES.flatMap((c) => {
        const d = describeNotification(c.notification);
        return [d.titleKey, d.bodyKey];
      }),
    );

    for (const key of used) expect(NOTIFICATION_MESSAGE_KEYS).toContain(key);
  });

  it('KHÔNG có khoá khai thừa: mọi khoá trong NOTIFICATION_MESSAGE_KEYS đều được bảng dùng tới', () => {
    const used = new Set(
      CASES.flatMap((c) => {
        const d = describeNotification(c.notification);
        return [d.titleKey, d.bodyKey];
      }),
    );

    expect([...NOTIFICATION_MESSAGE_KEYS].filter((key) => !used.has(key))).toEqual([]);
  });

  it.each(['vi', 'en'] as const)(
    'mọi khoá có bản dịch %s và không còn khoá dịch thừa',
    (locale) => {
      const messages = (locale === 'vi' ? viMessages : enMessages).notification as Record<
        string,
        string
      >;
      const declared = new Set<string>(NOTIFICATION_MESSAGE_KEYS);
      const messageKeys = Object.keys(messages).filter((key) => /^(title|body)/.test(key));

      for (const key of NOTIFICATION_MESSAGE_KEYS) {
        expect(messages[key], `${locale}.notification.${key}`).toEqual(expect.any(String));
        expect(messages[key].trim()).not.toBe('');
      }
      expect(messageKeys.filter((key) => !declared.has(key))).toEqual([]);
    },
  );
});

describe.each(['vi', 'en'] as const)('chữ hiển thị (%s)', (locale) => {
  it.each(CASES)('$name ⇒ có chữ thật, không lộ khoá thô, không còn {placeholder}', (c) => {
    const display = describeNotification(c.notification);

    const { title, body } = render(display, locale);

    for (const text of [title, body]) {
      expect(text.trim()).not.toBe('');
      expect(text).not.toContain(display.titleKey);
      expect(text).not.toContain(display.bodyKey);
      expect(text).not.toMatch(/\bnotification\.(title|body)/);
      expect(text).not.toMatch(/[{}]/);
    }
  });

  it('bản tiếng Anh không lẫn chuỗi tiếng Việt do mẫu dịch (chỉ chữ người dùng nhập được giữ nguyên)', () => {
    if (locale !== 'en') return;
    const vietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    for (const c of CASES) {
      // Dữ liệu mẫu có tên shop/lý do tiếng Việt: thay bằng ASCII để chỉ còn mẫu dịch.
      const n = JSON.parse(
        JSON.stringify(c.notification).replace(
          /Shop Áo|Áo thun|Hết hàng|Đổi ý|Không đủ điều kiện|Thiếu giấy phép|Shop Mới|Shop Bị Khóa/g,
          'x',
        ),
      ) as Notification;
      const { title, body } = render(describeNotification(n), 'en');
      expect(`${title} ${body}`, c.name).not.toMatch(vietnamese);
    }
  });
});

describe('nội dung theo ngữ cảnh', () => {
  const find = (name: string) => CASES.find((c) => c.name === name)!.notification;

  it('mã đơn hiển thị là 8 ký tự đầu của id đơn', () => {
    const { body } = render(describeNotification(find('ORDER_NEW')), 'vi');

    expect(body).toContain(`#${ORDER.slice(0, 8)}`);
    expect(body).not.toContain(ORDER);
  });

  it('có lý do ⇒ lý do hiện trong nội dung; không có lý do ⇒ không có chữ "Lý do"', () => {
    const withReason = describeNotification(find('ORDER_CANCELLED BUYER by SELLER'));
    const withoutReason = describeNotification({
      ...BASE,
      type: 'ORDER_CANCELLED',
      data: { orderId: ORDER, audience: 'BUYER', by: 'SELLER', shopName: 'Shop Áo' },
    });

    expect(render(withReason, 'vi').body).toContain('Lý do: Hết hàng');
    expect(render(withoutReason, 'vi').body).not.toContain('Lý do');
    expect(render(withoutReason, 'en').body).not.toContain('Reason');
    expect(render(withReason, 'en').body).toContain('Reason: Hết hàng');
  });

  it('lý do tình cờ trùng từ khoá của ICU ("other", "yes") vẫn hiển thị đúng', () => {
    const display = describeNotification({
      ...BASE,
      type: 'REFUND_REQUEST_REJECTED',
      data: { orderId: ORDER, kind: 'CANCEL', reason: 'other' },
    });

    expect(render(display, 'vi').body).toContain('Lý do: other');
  });

  it('loại yêu cầu: CANCEL ⇒ "hủy đơn", RETURN ⇒ "trả hàng" (vi) / cancellation, return (en)', () => {
    const cancel = describeNotification(find('REFUND_REQUEST_NEW CANCEL'));
    const ret = describeNotification(find('REFUND_REQUEST_NEW RETURN'));

    expect(render(cancel, 'vi').title).toBe('Yêu cầu hủy đơn mới');
    expect(render(ret, 'vi').title).toBe('Yêu cầu trả hàng mới');
    expect(render(cancel, 'en').body).toContain('cancel order');
    expect(render(ret, 'en').body).toContain('return items');
  });

  it('khiếu nại được Admin quyết định: duyệt ≠ từ chối', () => {
    const approved = render(
      describeNotification(find('REFUND_REQUEST_DECIDED_BY_ADMIN APPROVED')),
      'vi',
    );
    const rejected = render(
      describeNotification(find('REFUND_REQUEST_DECIDED_BY_ADMIN REJECTED')),
      'vi',
    );

    expect(approved.body).toContain('chấp nhận');
    expect(rejected.body).toContain('từ chối');
  });

  it('trạng thái shop: mỗi trạng thái một tiêu đề riêng, kèm lý do', () => {
    const titles = (['APPROVED', 'REJECTED', 'SUSPENDED', 'PENDING'] as const).map(
      (status) => render(describeNotification(find(`SHOP_STATUS_CHANGED ${status}`)), 'vi').title,
    );

    expect(new Set(titles).size).toBe(4);
    expect(render(describeNotification(find('SHOP_STATUS_CHANGED REJECTED')), 'vi').body).toContain(
      'Lý do: Thiếu giấy phép',
    );
  });

  it('kháng nghị: kết quả chấp nhận ≠ từ chối, và nội dung không chứa ghi chú của Admin', () => {
    const accepted = render(describeNotification(find('APPEAL_DECIDED ACCEPTED')), 'vi');
    const rejected = render(describeNotification(find('APPEAL_DECIDED REJECTED')), 'vi');

    expect(accepted.title).toBe('Kháng nghị được chấp nhận');
    expect(rejected.title).toBe('Kháng nghị bị từ chối');
    expect(accepted.body).not.toBe(rejected.body);
    expect(render(describeNotification(find('APPEAL_DECIDED ACCEPTED')), 'en').title).toBe(
      'Appeal accepted',
    );
    expect(render(describeNotification(find('APPEAL_DECIDED REJECTED')), 'en').title).toBe(
      'Appeal rejected',
    );
  });

  it('kháng nghị mới (Admin): nêu tên shop và dẫn tới hàng đợi kháng nghị', () => {
    const display = describeNotification(find('ADMIN_APPEAL_PENDING'));

    expect(display.href).toBe('/admin/appeals');
    expect(render(display, 'vi').body).toContain('Shop Bị Khóa');
    expect(render(display, 'en').body).toContain('Shop Bị Khóa');
  });

  it('báo cáo mới (Admin): mỗi loại đối tượng một câu riêng, chỉ nói loại gì bị báo — không có tên, lý do hay người báo', () => {
    const bodies = (['REVIEW', 'CONVERSATION', 'SHOP', 'PRODUCT'] as const).map((targetType) => {
      const display = describeNotification({
        ...BASE,
        type: 'REPORT_NEW',
        data: { reportId: ORDER, targetType },
      });
      return {
        vi: render(display, 'vi').body,
        en: render(display, 'en').body,
      };
    });

    expect(new Set(bodies.map((b) => b.vi)).size).toBe(4);
    expect(new Set(bodies.map((b) => b.en)).size).toBe(4);
    expect(bodies[0].vi).toContain('đánh giá');
    expect(bodies[1].vi).toContain('trò chuyện');
    expect(bodies[2].vi).toContain('shop');
    expect(bodies[3].vi).toContain('sản phẩm');
  });

  it('kết quả báo cáo (người báo): chữ chung chung, hai kết quả hai câu khác nhau, không nêu hành động cụ thể và không có đường dẫn', () => {
    const [resolved, dismissed] = (['RESOLVED', 'DISMISSED'] as const).map((outcome) =>
      describeNotification({
        ...BASE,
        type: 'REPORT_RESOLVED',
        data: { reportId: ORDER, targetType: 'SHOP', outcome },
      }),
    );

    expect(resolved.href).toBeNull();
    expect(dismissed.href).toBeNull();
    expect(render(resolved, 'vi').body).not.toBe(render(dismissed, 'vi').body);
    expect(render(resolved, 'en').body).not.toBe(render(dismissed, 'en').body);
    for (const locale of ['vi', 'en'] as const) {
      expect(render(resolved, locale).body).not.toMatch(/ẩn|khoá|khóa|gỡ|hide|suspend|remove|ban/i);
    }
  });

  it('phía nhận khác nhau ⇒ chữ khác nhau (hủy đơn: người mua vs chủ shop; khiếu nại: Admin vs chủ shop)', () => {
    const buyerSide = render(
      describeNotification(find('ORDER_CANCELLED BUYER by ADMIN')),
      'vi',
    ).body;
    const sellerSide = render(
      describeNotification(find('ORDER_CANCELLED SELLER by ADMIN')),
      'vi',
    ).body;
    const admin = render(describeNotification(find('REFUND_REQUEST_ESCALATED ADMIN')), 'vi').body;
    const seller = render(describeNotification(find('REFUND_REQUEST_ESCALATED SELLER')), 'vi').body;

    expect(buyerSide).not.toBe(sellerSide);
    expect(admin).not.toBe(seller);
  });

  it('loại lạ (UNKNOWN) ⇒ nhãn chung, không đường dẫn, không tham số', () => {
    const display = describeNotification(find('UNKNOWN'));

    expect(display.href).toBeNull();
    expect(display.params).toEqual({});
    expect(render(display, 'vi')).toEqual({
      title: 'Thông báo mới',
      body: 'Bạn có một thông báo mới.',
    });
  });
});

describe('an toàn của đường dẫn và chữ (D10)', () => {
  // Giả lập BE/FE lệch phiên bản hoặc dữ liệu bị sửa tay: schema đọc ở service đã chặn, đây là lớp thứ hai.
  const withOrderId = (orderId: string): Notification => ({
    ...BASE,
    type: 'ORDER_NEW',
    data: { orderId },
  });

  it.each([
    'not-a-uuid',
    '../../evil',
    'javascript:alert(1)',
    'https://evil.example/x',
    '//evil.example',
    '',
    `${ORDER}/../../x`,
    `${ORDER}?next=https://evil.example`,
  ])('orderId sai dạng %j ⇒ href null (không điều hướng, không ném lỗi)', (orderId) => {
    expect(() => describeNotification(withOrderId(orderId))).not.toThrow();
    expect(describeNotification(withOrderId(orderId)).href).toBeNull();
  });

  it('productId sai dạng ở REVIEW_REPLIED ⇒ href null', () => {
    const display = describeNotification({
      ...BASE,
      type: 'REVIEW_REPLIED',
      data: { productId: 'x/../y', productName: 'p', shopName: 's' },
    });

    expect(display.href).toBeNull();
  });

  it('mọi href là đường dẫn nội bộ: bắt đầu bằng MỘT dấu "/", không có scheme, không "//", không query/fragment', () => {
    for (const c of CASES) {
      const { href } = describeNotification(c.notification);
      if (href === null) continue;
      expect(href).toMatch(/^\/(?!\/)/);
      expect(href).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
      expect(href).not.toMatch(/[?#\\]/);
      expect(href).not.toContain('..');
    }
  });

  it('trường thừa trong `data` (kể cả URL) KHÔNG bao giờ lọt vào href hay tham số', () => {
    const tampered = {
      ...BASE,
      type: 'ORDER_NEW',
      data: { orderId: ORDER, url: 'https://evil.example', href: '//evil.example' },
    } as unknown as Notification;

    const display = describeNotification(tampered);

    expect(display.href).toBe(`/seller/orders/${ORDER}`);
    expect(JSON.stringify(display)).not.toContain('evil');
  });

  it('chữ do người dùng nhập đi vào tham số và được hiển thị NGUYÊN VĂN như text (không bị phân tích lại)', () => {
    const hostile = '{code} <img src=x onerror=alert(1)> {kind, select, CANCEL {a} other {b}}';
    const display = describeNotification({
      ...BASE,
      type: 'ORDER_CONFIRMED',
      data: { orderId: ORDER, shopName: hostile },
    });

    expect(() => render(display, 'vi')).not.toThrow();
    expect(render(display, 'vi').body).toBe(`${hostile} đã xác nhận đơn #${ORDER.slice(0, 8)}.`);
  });
});
