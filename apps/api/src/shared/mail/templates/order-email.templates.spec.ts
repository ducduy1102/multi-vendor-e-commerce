import { escapeHtml, formatVnd } from './html';
import { orderCancelledTemplate } from './order-cancelled.template';
import { orderCompletedTemplate } from './order-completed.template';
import { orderConfirmedTemplate } from './order-confirmed.template';
import type {
  OrderEmailOrder,
  OrderPlacedEmailData,
} from './order-email.types';
import { orderPlacedTemplate } from './order-placed.template';
import { orderShippedTemplate } from './order-shipped.template';
import { refundRequestRejectedTemplate } from './refund-request-rejected.template';

const ORDER: OrderEmailOrder = {
  orderCode: 'AB12CD34',
  shopName: 'Shop Áo Xinh',
  items: [
    {
      productName: 'Áo thun cotton',
      variantLabel: 'Đỏ / M',
      quantity: 2,
      unitPrice: 150_000,
    },
    {
      productName: 'Quần short',
      variantLabel: null,
      quantity: 1,
      unitPrice: 100_000,
    },
  ],
  shippingFee: 20_000,
  discountAmount: 10_000,
  totalAmount: 410_000,
};

const BASE = {
  locale: 'vi' as const,
  buyerName: 'Nguyễn Văn A',
  ordersUrl: 'http://localhost:3000/orders/o1',
};

const PLACED: OrderPlacedEmailData = {
  ...BASE,
  orders: [ORDER],
  paymentMethod: 'VNPAY',
  recipient: {
    name: 'Nguyễn Văn A',
    phone: '0912345678',
    address: '12 Nguyễn Huệ, Phường Bến Nghé, Hồ Chí Minh',
  },
};

describe('escapeHtml', () => {
  it('escape đủ 5 ký tự nguy hiểm', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('không đổi chuỗi bình thường (kể cả tiếng Việt có dấu)', () => {
    expect(escapeHtml('Áo thun đẹp')).toBe('Áo thun đẹp');
  });
});

describe('formatVnd', () => {
  it('định dạng vi-VN, không phần thập phân', () => {
    // Intl dùng khoảng trắng không ngắt giữa số và ký hiệu — chuẩn hoá để so khớp.
    expect(formatVnd(1_234_000).replace(/\s/g, ' ')).toBe('1.234.000 ₫');
    expect(formatVnd(0).replace(/\s/g, ' ')).toBe('0 ₫');
  });
});

describe('orderPlacedTemplate', () => {
  it('đơn đã thanh toán online: tiêu đề "thanh toán thành công", không nói thanh toán khi nhận hàng', () => {
    const { subject, html } = orderPlacedTemplate(PLACED);

    expect(subject).toBe(
      'Thanh toán thành công — đơn hàng đang chờ shop xác nhận',
    );
    expect(html).toContain('đã nhận được thanh toán');
    expect(html).not.toContain('khi nhận hàng');
  });

  it('đơn COD: tiêu đề "thanh toán khi nhận hàng", nêu đúng số tiền phải trả, không nói đã thanh toán', () => {
    const { subject, html } = orderPlacedTemplate({
      ...PLACED,
      paymentMethod: 'COD',
    });

    expect(subject).toBe('Đặt hàng thành công — thanh toán khi nhận hàng');
    expect(html).toContain('khi nhận hàng');
    expect(html.replace(/\s/g, ' ')).toContain('410.000 ₫');
    expect(html).not.toContain('đã nhận được thanh toán');
  });

  it('liệt kê shop, mã đơn, dòng hàng, phí ship, giảm giá, tổng và địa chỉ giao', () => {
    const { html } = orderPlacedTemplate(PLACED);
    const text = html.replace(/\s/g, ' ');

    for (const expected of [
      'Shop Áo Xinh',
      '#AB12CD34',
      'Áo thun cotton (Đỏ / M) × 2',
      'Quần short × 1',
      '300.000 ₫', // 2 × 150.000
      'Phí vận chuyển',
      'Giảm giá',
      '-10.000 ₫',
      '410.000 ₫',
      'Nguyễn Văn A',
      '0912345678',
      '12 Nguyễn Huệ, Phường Bến Nghé, Hồ Chí Minh',
      'http://localhost:3000/orders/o1',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('không có giảm giá thì không hiện dòng giảm giá', () => {
    const { html } = orderPlacedTemplate({
      ...PLACED,
      orders: [{ ...ORDER, discountAmount: 0 }],
    });

    expect(html).not.toContain('Giảm giá');
  });

  it('nhiều đơn (nhiều shop): mỗi shop 1 khối, tổng tiền email là tổng các đơn', () => {
    const { html } = orderPlacedTemplate({
      ...PLACED,
      paymentMethod: 'COD',
      orders: [
        ORDER,
        {
          ...ORDER,
          orderCode: 'ZZ99YY88',
          shopName: 'Shop B',
          totalAmount: 90_000,
        },
      ],
    });
    const text = html.replace(/\s/g, ' ');

    expect(text).toContain('Shop Áo Xinh');
    expect(text).toContain('Shop B');
    expect(text).toContain('500.000 ₫'); // 410.000 + 90.000 trong câu dẫn
  });
});

describe('orderConfirmedTemplate', () => {
  it('tiêu đề có tên shop, nội dung có mã đơn và link', () => {
    const { subject, html } = orderConfirmedTemplate({ ...BASE, order: ORDER });

    expect(subject).toBe('Shop Áo Xinh đã xác nhận đơn hàng của bạn');
    expect(html).toContain('#AB12CD34');
    expect(html).toContain('http://localhost:3000/orders/o1');
  });
});

describe('orderShippedTemplate', () => {
  it('có đơn vị vận chuyển và mã vận đơn — hiện cả 2', () => {
    const { subject, html } = orderShippedTemplate({
      ...BASE,
      order: ORDER,
      carrier: 'GHN',
      trackingCode: 'GHN123456',
    });

    expect(subject).toBe('Đơn hàng của bạn đang được giao');
    expect(html).toContain('Đơn vị vận chuyển: <strong>GHN</strong>');
    expect(html).toContain('Mã vận đơn: <strong>GHN123456</strong>');
  });

  it('seller không nhập gì — không có dòng vận chuyển nào, vẫn hợp lệ', () => {
    const { html } = orderShippedTemplate({
      ...BASE,
      order: ORDER,
      carrier: null,
      trackingCode: null,
    });

    expect(html).not.toContain('Đơn vị vận chuyển');
    expect(html).not.toContain('Mã vận đơn');
  });
});

describe('orderCancelledTemplate', () => {
  it.each([
    [
      'SELLER',
      'Đơn hàng của bạn đã bị shop từ chối',
      'shop không thể thực hiện',
    ],
    ['BUYER', 'Bạn đã hủy đơn hàng', 'theo yêu cầu của bạn'],
    ['SYSTEM', 'Đơn hàng đã bị hủy do hết hạn thanh toán', 'thời hạn giữ hàng'],
    [
      'ADMIN',
      'Đơn hàng của bạn đã bị quản trị viên hủy',
      'quản trị viên của sàn hủy vì shop này đang bị tạm ngừng hoạt động',
    ],
  ] as const)('%s: đúng tiêu đề và câu dẫn', (cancelledBy, subject, lead) => {
    const result = orderCancelledTemplate({
      ...BASE,
      orders: [ORDER],
      cancelledBy,
      reason: null,
    });

    expect(result.subject).toBe(subject);
    expect(result.html).toContain(lead);
    expect(result.html).not.toContain('Lý do:');
  });

  it('có lý do — hiện dòng lý do', () => {
    const { html } = orderCancelledTemplate({
      ...BASE,
      orders: [ORDER],
      cancelledBy: 'SELLER',
      reason: 'Hết hàng',
    });

    expect(html).toContain('<strong>Lý do:</strong> Hết hàng');
  });

  describe('Admin hủy (Week11.md 4.2)', () => {
    it('Admin KHÔNG còn bị nói là "hết hạn thanh toán" như khi rơi vào SYSTEM', () => {
      const { subject, html } = orderCancelledTemplate({
        ...BASE,
        orders: [ORDER],
        cancelledBy: 'ADMIN',
        reason: null,
      });

      expect(subject).not.toContain('hết hạn thanh toán');
      expect(html).not.toContain('thời hạn giữ hàng');
      expect(html).not.toContain('theo yêu cầu của bạn');
    });

    it('kèm lý do của Admin và đoạn "đang hoàn" khi đơn đã trả online', () => {
      const { html } = orderCancelledTemplate({
        ...BASE,
        orders: [ORDER],
        cancelledBy: 'ADMIN',
        reason: 'Shop vi phạm chính sách',
        refundAmount: 410_000,
      });

      expect(html).toContain('<strong>Lý do:</strong> Shop vi phạm chính sách');
      expect(html).toContain(
        `Chúng tôi đang hoàn ${formatVnd(410_000)} về phương thức thanh toán ban đầu`,
      );
    });

    it('đơn COD (không có khoản hoàn) → không có đoạn hoàn tiền', () => {
      const { html } = orderCancelledTemplate({
        ...BASE,
        orders: [ORDER],
        cancelledBy: 'ADMIN',
        reason: 'Shop vi phạm chính sách',
        refundAmount: null,
      });

      expect(html).not.toContain('đang hoàn');
    });

    it('bản tiếng Anh nói rõ do quản trị viên, không lẫn "payment expired"', () => {
      const { subject, html } = orderCancelledTemplate({
        ...BASE,
        locale: 'en',
        orders: [ORDER],
        cancelledBy: 'ADMIN',
        reason: null,
      });

      expect(subject).toBe(
        'Your order was cancelled by a marketplace administrator',
      );
      expect(html).toContain(
        'a marketplace administrator has cancelled your order',
      );
      expect(html).not.toContain('payment expired');
      expect(html).not.toContain('hold period');
    });
  });

  describe('đoạn hoàn tiền (Week9.md 1.5)', () => {
    it('có khoản hoàn — nói "ĐANG hoàn" kèm số tiền, không khẳng định đã hoàn xong', () => {
      const { html } = orderCancelledTemplate({
        ...BASE,
        orders: [ORDER],
        cancelledBy: 'BUYER',
        reason: null,
        refundAmount: 410_000,
      });

      expect(html).toContain(
        `Chúng tôi đang hoàn ${formatVnd(410_000)} về phương thức thanh toán ban đầu`,
      );
      expect(html).not.toContain('đã hoàn');
    });

    it.each([undefined, null, 0])(
      'refundAmount %p — không có đoạn hoàn tiền',
      (refundAmount) => {
        const { html } = orderCancelledTemplate({
          ...BASE,
          orders: [ORDER],
          cancelledBy: 'SELLER',
          reason: null,
          refundAmount,
        });

        expect(html).not.toContain('đang hoàn');
      },
    );
  });
});

describe('orderCompletedTemplate (Week10.md 7.5)', () => {
  const COMPLETED = {
    ...BASE,
    order: ORDER,
    completedBy: 'BUYER' as const,
    autoCompleteDays: 0,
    returnWindowDays: 7,
    invitesReview: true,
  };

  it('người mua tự bấm: cảm ơn, KHÔNG nhắc tự hoàn tất, có mã đơn trong tiêu đề', () => {
    const { subject, html } = orderCompletedTemplate(COMPLETED);

    expect(subject).toBe('Đơn hàng #AB12CD34 đã hoàn tất');
    expect(html).toContain('Cảm ơn bạn đã xác nhận đã nhận hàng');
    expect(html).not.toContain('tự động hoàn tất');
  });

  it('hệ thống tự hoàn tất: nêu RÕ lý do và số ngày chờ', () => {
    const { subject, html } = orderCompletedTemplate({
      ...COMPLETED,
      completedBy: 'SYSTEM',
      autoCompleteDays: 7,
    });

    expect(subject).toBe('Đơn hàng #AB12CD34 đã được tự động hoàn tất');
    expect(html).toContain('chưa được bạn xác nhận sau 7 ngày');
    expect(html).toContain('hệ thống đã tự động hoàn tất đơn hàng');
  });

  it('nhắc cửa sổ trả hàng/hoàn tiền còn lại ở cả hai nhánh', () => {
    for (const completedBy of ['BUYER', 'SYSTEM'] as const) {
      const { html } = orderCompletedTemplate({
        ...COMPLETED,
        completedBy,
        returnWindowDays: 14,
      });

      expect(html).toContain('trả hàng/hoàn tiền');
      expect(html).toContain('trong 14 ngày kể từ hôm nay');
    }
  });

  it('còn sản phẩm chưa đánh giá: mời đánh giá và nút là "Đánh giá sản phẩm"', () => {
    const { html } = orderCompletedTemplate(COMPLETED);

    expect(html).toContain('đánh giá sản phẩm');
    expect(html).toContain('>Đánh giá sản phẩm</a>');
  });

  it('mọi sản phẩm đã được đánh giá: KHÔNG mời đánh giá, nút là "Xem đơn hàng"', () => {
    const { html } = orderCompletedTemplate({
      ...COMPLETED,
      invitesReview: false,
    });

    expect(html).not.toContain('Đánh giá sản phẩm');
    expect(html).not.toContain('giúp những người mua khác');
    expect(html).toContain('>Xem đơn hàng</a>');
  });

  it('có khối tóm tắt đơn và link trỏ tới đơn', () => {
    const { html } = orderCompletedTemplate(COMPLETED);

    expect(html).toContain('Shop Áo Xinh');
    expect(html).toContain('href="http://localhost:3000/orders/o1"');
  });

  it('tiếng Anh: số ít "1 day" và số nhiều "7 days"', () => {
    const one = orderCompletedTemplate({
      ...COMPLETED,
      locale: 'en',
      completedBy: 'SYSTEM',
      autoCompleteDays: 1,
      returnWindowDays: 1,
    });
    const many = orderCompletedTemplate({
      ...COMPLETED,
      locale: 'en',
      completedBy: 'SYSTEM',
      autoCompleteDays: 7,
      returnWindowDays: 7,
    });

    expect(one.html).toContain('within 1 day, so we completed');
    expect(one.html).toContain('within 1 day from today');
    expect(many.html).toContain('within 7 days, so we completed');
    expect(many.html).toContain('within 7 days from today');
  });
});

describe('refundRequestRejectedTemplate (Week10.md 7.5)', () => {
  const REJECTED = {
    ...BASE,
    order: ORDER,
    kind: 'CANCEL' as const,
    rejectedBy: 'SELLER' as const,
    reason: 'Hàng đã giao cho đơn vị vận chuyển',
    escalateDays: 3,
  };

  it.each([
    ['CANCEL', 'hủy đơn'],
    ['RETURN', 'trả hàng/hoàn tiền'],
  ] as const)('loại %s: tiêu đề gọi đúng tên loại yêu cầu', (kind, label) => {
    const { subject, html } = refundRequestRejectedTemplate({
      ...REJECTED,
      kind,
    });

    expect(subject).toBe(`Shop đã từ chối yêu cầu ${label} cho đơn #AB12CD34`);
    expect(html).toContain(`yêu cầu ${label} của bạn cho đơn hàng #AB12CD34`);
  });

  it('shop từ chối: hiện lý do và nêu còn khiếu nại được lên sàn trong N ngày', () => {
    const { html } = refundRequestRejectedTemplate(REJECTED);

    expect(html).toContain(
      '<strong>Lý do:</strong> Hàng đã giao cho đơn vị vận chuyển',
    );
    expect(html).toContain(
      'khiếu nại lên sàn từ trang đơn hàng trong 3 ngày kể từ hôm nay',
    );
    expect(html).not.toContain('quyết định cuối cùng');
  });

  it('shop từ chối nhưng không còn đường khiếu nại (escalateDays null): không hứa hẹn gì', () => {
    const { html } = refundRequestRejectedTemplate({
      ...REJECTED,
      escalateDays: null,
    });

    expect(html).not.toContain('khiếu nại');
  });

  it('Admin từ chối: câu dẫn của sàn, nói đây là quyết định cuối cùng, KHÔNG mời khiếu nại', () => {
    const { subject, html } = refundRequestRejectedTemplate({
      ...REJECTED,
      rejectedBy: 'ADMIN',
      escalateDays: null,
    });

    expect(subject).toBe('Yêu cầu hủy đơn cho đơn #AB12CD34 đã bị từ chối');
    expect(html).toContain('Sau khi xem xét, sàn đã từ chối');
    expect(html).toContain('quyết định cuối cùng của sàn');
    expect(html).not.toContain('khiếu nại lên sàn');
  });

  it('Admin từ chối: bỏ qua escalateDays dù được truyền vào', () => {
    const { html } = refundRequestRejectedTemplate({
      ...REJECTED,
      rejectedBy: 'ADMIN',
      escalateDays: 3,
    });

    expect(html).not.toContain('trong 3 ngày');
  });

  it('không có lý do: không có dòng "Lý do"', () => {
    const { html } = refundRequestRejectedTemplate({
      ...REJECTED,
      reason: null,
    });

    expect(html).not.toContain('Lý do:');
  });

  it('tiếng Anh: tên loại và số ít/số nhiều của ngày', () => {
    const one = refundRequestRejectedTemplate({
      ...REJECTED,
      locale: 'en',
      kind: 'RETURN',
      escalateDays: 1,
    });
    const many = refundRequestRejectedTemplate({
      ...REJECTED,
      locale: 'en',
      escalateDays: 3,
    });

    expect(one.subject).toBe(
      'The shop declined your return/refund request for order #AB12CD34',
    );
    expect(one.html).toContain('within 1 day from today');
    expect(many.html).toContain('within 3 days from today');
  });

  it('có khối tóm tắt đơn và link trỏ tới đơn', () => {
    const { html } = refundRequestRejectedTemplate(REJECTED);

    expect(html).toContain('Shop Áo Xinh');
    expect(html).toContain('href="http://localhost:3000/orders/o1"');
  });
});

describe('chống chèn HTML (dữ liệu người dùng/seller nhập)', () => {
  const EVIL = `<script>alert(1)</script><a href="https://evil.example">bấm vào</a>`;

  it('lý do từ chối của seller được escape — không chèn được thẻ/link vào email gửi buyer', () => {
    const { html } = orderCancelledTemplate({
      ...BASE,
      orders: [ORDER],
      cancelledBy: 'SELLER',
      reason: EVIL,
    });

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="https://evil.example"');
    expect(html).toContain('&lt;script&gt;');
  });

  it('tên buyer, tên shop, tên sản phẩm, địa chỉ, đơn vị vận chuyển, mã vận đơn đều được escape', () => {
    const evilOrder: OrderEmailOrder = {
      ...ORDER,
      shopName: EVIL,
      items: [{ ...ORDER.items[0], productName: EVIL, variantLabel: EVIL }],
    };
    const outputs = [
      orderPlacedTemplate({
        ...PLACED,
        buyerName: EVIL,
        orders: [evilOrder],
        recipient: { name: EVIL, phone: EVIL, address: EVIL },
      }).html,
      orderConfirmedTemplate({ ...BASE, buyerName: EVIL, order: evilOrder })
        .html,
      orderShippedTemplate({
        ...BASE,
        buyerName: EVIL,
        order: evilOrder,
        carrier: EVIL,
        trackingCode: EVIL,
      }).html,
      orderCancelledTemplate({
        ...BASE,
        buyerName: EVIL,
        orders: [evilOrder],
        cancelledBy: 'BUYER',
        reason: EVIL,
      }).html,
      orderCompletedTemplate({
        ...BASE,
        buyerName: EVIL,
        order: evilOrder,
        completedBy: 'SYSTEM',
        autoCompleteDays: 7,
        returnWindowDays: 7,
        invitesReview: true,
      }).html,
      refundRequestRejectedTemplate({
        ...BASE,
        buyerName: EVIL,
        order: evilOrder,
        kind: 'RETURN',
        rejectedBy: 'SELLER',
        reason: EVIL,
        escalateDays: 3,
      }).html,
    ];

    for (const html of outputs) {
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<a href="https://evil.example">');
    }
  });

  it('subject không chứa HTML thô từ tên shop (tiêu đề email là văn bản thuần)', () => {
    const { subject } = orderConfirmedTemplate({
      ...BASE,
      order: { ...ORDER, shopName: 'Shop A & B' },
    });

    // Subject KHÔNG phải HTML nên không escape (escape sẽ làm hiện "&amp;" cho người đọc).
    expect(subject).toBe('Shop A & B đã xác nhận đơn hàng của bạn');
  });
});
