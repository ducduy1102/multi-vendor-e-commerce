import {
  cancelOrderSchema,
  ORDER_REASON_MAX_LENGTH,
  ORDER_SHIPPING_FIELD_MAX_LENGTH,
  ORDER_STATUSES_VISIBLE_TO_SELLER,
  ORDER_TAB_STATUSES,
  orderActorTypeSchema,
  orderDetailItemSchema,
  orderDetailSchema,
  orderListItemSchema,
  orderListQuerySchema,
  orderStatusSchema,
  orderTabSchema,
  rejectOrderSchema,
  sellerCancelOrderSchema,
  sellerOrderDetailSchema,
  sellerOrderListItemSchema,
  sellerOrderListQuerySchema,
  sellerOrderTabSchema,
  sellerRefundRequestListItemSchema,
  sellerRefundRequestListQuerySchema,
  shipOrderSchema,
} from '@ecommerce/types';
import { OrderActorType } from '@prisma/client';

// Schema Zod dùng chung cho đơn hàng (packages/types/src/order.ts, Week8.md 2.3). packages/types
// không có test runner riêng — test ở đây (đúng precedent shop.schema.test.ts ở FE).

describe('enum dùng chung khớp Prisma', () => {
  it('OrderActorType', () => {
    expect([...orderActorTypeSchema.options].sort()).toEqual(
      Object.values(OrderActorType).sort(),
    );
  });
});

describe('ORDER_TAB_STATUSES', () => {
  it('phân hoạch đầy đủ: mỗi OrderStatus thuộc đúng 1 tab, không sót, không trùng', () => {
    const all = Object.values(ORDER_TAB_STATUSES).flat();

    expect([...all].sort()).toEqual([...orderStatusSchema.options].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it('có đủ khoá cho mọi tab', () => {
    expect(Object.keys(ORDER_TAB_STATUSES).sort()).toEqual(
      [...orderTabSchema.options].sort(),
    );
  });

  it('mọi tab của Seller chỉ chứa trạng thái Seller được thấy (không lộ AWAITING_PAYMENT)', () => {
    for (const tab of sellerOrderTabSchema.options) {
      for (const status of ORDER_TAB_STATUSES[tab]) {
        expect(ORDER_STATUSES_VISIBLE_TO_SELLER).toContain(status);
      }
    }
  });
});

describe('orderListQuerySchema', () => {
  it('mặc định page=1, limit=10, không tab', () => {
    expect(orderListQuerySchema.parse({})).toEqual({ page: 1, limit: 10 });
  });

  it('coerce page/limit từ chuỗi (query param luôn là string)', () => {
    expect(
      orderListQuerySchema.parse({ page: '2', limit: '25', tab: 'shipping' }),
    ).toEqual({ page: 2, limit: 25, tab: 'shipping' });
  });

  it.each([{ limit: '51' }, { limit: '0' }, { page: '0' }, { page: 'abc' }])(
    'từ chối giá trị phân trang sai %o',
    (query) => {
      expect(orderListQuerySchema.safeParse(query).success).toBe(false);
    },
  );

  it('từ chối tab lạ', () => {
    expect(orderListQuerySchema.safeParse({ tab: 'refunded' }).success).toBe(
      false,
    );
  });
});

describe('sellerOrderListQuerySchema', () => {
  it('từ chối tab awaiting-payment (đơn chưa trả tiền không lộ cho Seller)', () => {
    expect(
      sellerOrderListQuerySchema.safeParse({ tab: 'awaiting-payment' }).success,
    ).toBe(false);
  });

  it('nhận các tab còn lại', () => {
    for (const tab of sellerOrderTabSchema.options) {
      expect(sellerOrderListQuerySchema.parse({ tab }).tab).toBe(tab);
    }
  });
});

describe('cancelOrderSchema', () => {
  it('lý do tuỳ chọn: bỏ trống hoặc chuỗi rỗng đều thành undefined', () => {
    expect(cancelOrderSchema.parse({})).toEqual({ reason: undefined });
    expect(cancelOrderSchema.parse({ reason: '' })).toEqual({
      reason: undefined,
    });
    expect(cancelOrderSchema.parse({ reason: '   ' })).toEqual({
      reason: undefined,
    });
  });

  it('cắt khoảng trắng hai đầu', () => {
    expect(cancelOrderSchema.parse({ reason: '  Đặt nhầm  ' }).reason).toBe(
      'Đặt nhầm',
    );
  });

  it('quá dài → key i18n', () => {
    const result = cancelOrderSchema.safeParse({
      reason: 'a'.repeat(ORDER_REASON_MAX_LENGTH + 1),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(
      'order.validationReasonTooLong',
    );
  });
});

describe('rejectOrderSchema', () => {
  it.each([{}, { reason: '' }, { reason: '   ' }])(
    'lý do bắt buộc: %o → key i18n',
    (body) => {
      const result = rejectOrderSchema.safeParse(body);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe(
        'order.validationReasonRequired',
      );
    },
  );

  it('hợp lệ', () => {
    expect(rejectOrderSchema.parse({ reason: ' Hết hàng ' })).toEqual({
      reason: 'Hết hàng',
    });
  });
});

describe('shipOrderSchema', () => {
  it('cả 2 field tuỳ chọn, rỗng coi như chưa nhập', () => {
    expect(shipOrderSchema.parse({})).toEqual({
      carrier: undefined,
      trackingCode: undefined,
    });
    expect(shipOrderSchema.parse({ carrier: '', trackingCode: ' ' })).toEqual({
      carrier: undefined,
      trackingCode: undefined,
    });
  });

  it('nhận đơn vị vận chuyển và mã vận đơn', () => {
    expect(
      shipOrderSchema.parse({ carrier: 'GHN', trackingCode: 'GHN123456' }),
    ).toEqual({ carrier: 'GHN', trackingCode: 'GHN123456' });
  });

  it('quá dài → key i18n riêng cho từng field', () => {
    const tooLong = 'x'.repeat(ORDER_SHIPPING_FIELD_MAX_LENGTH + 1);

    expect(
      shipOrderSchema.safeParse({ carrier: tooLong }).error?.issues[0].message,
    ).toBe('order.validationCarrierTooLong');
    expect(
      shipOrderSchema.safeParse({ trackingCode: tooLong }).error?.issues[0]
        .message,
    ).toBe('order.validationTrackingCodeTooLong');
  });
});

describe('response schema', () => {
  const item = {
    productName: 'Áo thun',
    variantLabel: 'Đỏ / M',
    sku: 'SKU-1',
    imageUrl: null,
    quantity: 2,
    priceAtPurchase: '100000',
  };
  const history = [
    {
      fromStatus: null,
      toStatus: 'AWAITING_PAYMENT',
      actorType: 'BUYER',
      note: null,
      createdAt: '2026-10-01T10:00:00.000Z',
    },
  ];

  it('orderDetailSchema parse được và không giữ field thừa (vd actorId của history)', () => {
    const parsed = orderDetailSchema.parse({
      id: 'o1',
      checkoutGroupId: 'g1',
      status: 'AWAITING_PAYMENT',
      createdAt: '2026-10-01T10:00:00.000Z',
      totalAmount: '220000',
      shop: { id: 's1', name: 'Shop A', slug: 'shop-a', logoUrl: null },
      items: [
        {
          ...item,
          productId: 'p1',
          productSlug: 'ao-thun',
          canReview: false,
          review: null,
        },
      ],
      itemCount: 1,
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      canCancel: true,
      canRequestCancel: false,
      canRequestReturn: false,
      canConfirmReceived: false,
      canRetryPayment: false,
      refundRequest: null,
      refund: null,
      recipientName: 'Nguyễn Văn A',
      recipientPhone: '0912345678',
      shippingAddressLine: '12 Nguyễn Huệ',
      shippingWard: 'Phường Bến Nghé',
      shippingProvince: 'Hồ Chí Minh',
      subtotal: '200000',
      discountAmount: '0',
      shippingFee: '20000',
      carrier: null,
      trackingCode: null,
      buyerNote: 'Giao giờ hành chính',
      history: [{ ...history[0], actorId: 'secret-user-id' }],
    });

    expect(parsed.history[0]).not.toHaveProperty('actorId');
    expect(parsed.items[0]).toMatchObject({
      productId: 'p1',
      productSlug: 'ao-thun',
    });
    expect(parsed.paymentMethod).toBe('COD');
    // z.object tự bỏ field không khai — field phải có trong schema thì FE mới đọc được (general.md mục 4).
    expect(parsed.buyerNote).toBe('Giao giờ hành chính');
  });

  describe('orderDetailItemSchema (Week9.md 1.8)', () => {
    const detailItem = {
      ...item,
      productId: 'p1',
      productSlug: 'ao-thun',
      canReview: true,
      review: null,
    };

    it('dòng hàng chưa đánh giá: canReview + review null', () => {
      expect(orderDetailItemSchema.parse(detailItem)).toMatchObject({
        productId: 'p1',
        productSlug: 'ao-thun',
        canReview: true,
        review: null,
      });
    });

    it('đánh giá của chính mình giữ đủ trường FE cần để dựng nút sửa và điền sẵn form (không rơi mất do z.object strip)', () => {
      const review = {
        id: 'rv-1',
        rating: 4,
        comment: 'Tốt',
        editedAt: null,
        canEdit: true,
      };

      expect(
        orderDetailItemSchema.parse({ ...detailItem, canReview: false, review })
          .review,
      ).toEqual(review);
    });

    it.each(['productId', 'productSlug', 'canReview', 'review'])(
      'thiếu %s ⇒ lỗi (BE phải luôn trả đủ, FE không tự đoán)',
      (field) => {
        const incomplete: Record<string, unknown> = { ...detailItem };
        delete incomplete[field];

        expect(orderDetailItemSchema.safeParse(incomplete).success).toBe(false);
      },
    );
  });

  describe('refundRequest / refund (Week9.md 2.6)', () => {
    const base = {
      id: 'o1',
      checkoutGroupId: 'g1',
      status: 'CONFIRMED',
      createdAt: '2026-10-01T10:00:00.000Z',
      totalAmount: '220000',
      shop: { id: 's1', name: 'Shop A', slug: 'shop-a', logoUrl: null },
      items: [item],
      itemCount: 1,
      paymentMethod: 'VNPAY',
      paymentStatus: 'SUCCESS',
      canCancel: false,
      canRequestCancel: false,
      canRequestReturn: false,
      canConfirmReceived: false,
      canRetryPayment: false,
    };
    const request = {
      id: 'r1',
      kind: 'CANCEL',
      status: 'REJECTED_BY_SELLER',
      reasonCode: 'CHANGE_OF_MIND',
      reasonNote: null,
      sellerRespondBy: '2026-10-03T10:00:00.000Z',
      statusChangedAt: '2026-10-02T10:00:00.000Z',
      createdAt: '2026-10-01T10:00:00.000Z',
      history: [
        {
          toStatus: 'PENDING_SELLER',
          actorType: 'BUYER',
          note: null,
          createdAt: '2026-10-01T10:00:00.000Z',
          actorId: 'secret-buyer-id',
          fromStatus: null,
        },
        {
          toStatus: 'REJECTED_BY_SELLER',
          actorType: 'SELLER',
          note: 'Đã đóng gói',
          createdAt: '2026-10-02T10:00:00.000Z',
          actorId: 'secret-seller-id',
        },
      ],
      canWithdraw: false,
      canEscalate: true,
    };

    it('danh sách và chi tiết đều mang refundRequest (hoặc null) và refund (hoặc null)', () => {
      const parsed = orderListItemSchema.parse({
        ...base,
        refundRequest: request,
        refund: { status: 'PENDING', amount: '220000' },
      });

      expect(parsed.refundRequest).toMatchObject({
        id: 'r1',
        status: 'REJECTED_BY_SELLER',
        canEscalate: true,
      });
      expect(parsed.refund).toEqual({ status: 'PENDING', amount: '220000' });
      expect(
        orderListItemSchema.parse({
          ...base,
          refundRequest: null,
          refund: null,
        }).refundRequest,
      ).toBeNull();
    });

    it('dòng thời gian của yêu cầu KHÔNG lộ actorId (danh tính seller/Admin) dù BE lỡ trả thừa', () => {
      const parsed = orderListItemSchema.parse({
        ...base,
        refundRequest: request,
        refund: null,
      });

      for (const entry of parsed.refundRequest?.history ?? []) {
        expect(entry).not.toHaveProperty('actorId');
        expect(entry).not.toHaveProperty('fromStatus');
      }
      expect(parsed.refundRequest?.history[1].note).toBe('Đã đóng gói');
    });

    it('thiếu refundRequest hoặc refund bị từ chối (BE phải trả null tường minh, không để undefined)', () => {
      expect(
        orderListItemSchema.safeParse({ ...base, refund: null }).success,
      ).toBe(false);
      expect(
        orderListItemSchema.safeParse({ ...base, refundRequest: null }).success,
      ).toBe(false);
    });

    it('trạng thái hoàn tiền lạ bị từ chối', () => {
      expect(
        orderListItemSchema.safeParse({
          ...base,
          refundRequest: null,
          refund: { status: 'WEIRD', amount: '1' },
        }).success,
      ).toBe(false);
    });
  });

  describe('seller: refundRequest (Week9.md 2.7)', () => {
    const base = {
      id: 'o1',
      status: 'CONFIRMED',
      createdAt: '2026-10-01T10:00:00.000Z',
      totalAmount: '220000',
      recipientName: 'Nguyễn Văn A',
      shippingProvince: 'Hồ Chí Minh',
      buyerNote: null,
      items: [item],
      itemCount: 1,
      paymentMethod: 'VNPAY',
      paymentStatus: 'SUCCESS',
      canConfirm: false,
      canPack: false,
      canShip: false,
      canReject: false,
      canCancel: true,
    };
    const summary = {
      id: 'r1',
      kind: 'CANCEL',
      status: 'PENDING_SELLER',
      sellerRespondBy: '2026-10-03T10:00:00.000Z',
    };
    const full = {
      ...summary,
      reasonCode: 'CHANGE_OF_MIND',
      reasonNote: 'Đổi ý',
      statusChangedAt: '2026-10-01T12:00:00.000Z',
      createdAt: '2026-10-01T12:00:00.000Z',
      history: [
        {
          toStatus: 'PENDING_SELLER',
          actorType: 'BUYER',
          note: null,
          createdAt: '2026-10-01T12:00:00.000Z',
          actorId: 'buyer-secret-id',
        },
      ],
      canApprove: true,
      canReject: true,
    };
    const detailRest = {
      recipientPhone: '0912345678',
      shippingAddressLine: '12 Nguyễn Huệ',
      shippingWard: 'Phường Bến Nghé',
      subtotal: '200000',
      discountAmount: '0',
      shippingFee: '20000',
      carrier: null,
      trackingCode: null,
      history,
    };

    it('danh sách đơn chỉ mang TÓM TẮT (không lý do của người mua) dù BE lỡ trả thừa', () => {
      const parsed = sellerOrderListItemSchema.parse({
        ...base,
        refundRequest: full,
      });

      expect(parsed.refundRequest).toEqual(summary);
    });

    it('chi tiết đơn mang yêu cầu đầy đủ: lý do, cờ duyệt/từ chối, timeline KHÔNG có actorId', () => {
      const parsed = sellerOrderDetailSchema.parse({
        ...base,
        ...detailRest,
        refundRequest: full,
      });

      expect(parsed.refundRequest).toMatchObject({
        reasonCode: 'CHANGE_OF_MIND',
        reasonNote: 'Đổi ý',
        canApprove: true,
        canReject: true,
      });
      expect(parsed.refundRequest?.history[0]).not.toHaveProperty('actorId');
    });

    it('thiếu refundRequest bị từ chối ở cả danh sách lẫn chi tiết (BE phải trả null tường minh)', () => {
      expect(sellerOrderListItemSchema.safeParse(base).success).toBe(false);
      expect(
        sellerOrderDetailSchema.safeParse({ ...base, ...detailRest }).success,
      ).toBe(false);
      expect(
        sellerOrderListItemSchema.safeParse({ ...base, refundRequest: null })
          .success,
      ).toBe(true);
    });

    it('chi tiết với tóm tắt (thiếu lý do) bị từ chối — hai hình dạng không lẫn nhau', () => {
      expect(
        sellerOrderDetailSchema.safeParse({
          ...base,
          ...detailRest,
          refundRequest: summary,
        }).success,
      ).toBe(false);
    });
  });

  describe('sellerCancelOrderSchema (Week9.md 2.7)', () => {
    it('lý do bắt buộc, trim, tối đa 500 ký tự — cùng luật với từ chối đơn', () => {
      expect(sellerCancelOrderSchema.parse({ reason: '  Hết hàng ' })).toEqual({
        reason: 'Hết hàng',
      });
      expect(sellerCancelOrderSchema.safeParse({}).success).toBe(false);
      expect(sellerCancelOrderSchema.safeParse({ reason: '   ' }).success).toBe(
        false,
      );
      expect(
        sellerCancelOrderSchema.safeParse({
          reason: 'x'.repeat(ORDER_REASON_MAX_LENGTH + 1),
        }).success,
      ).toBe(false);
    });
  });

  describe('sellerRefundRequestListQuerySchema (Week9.md 2.7)', () => {
    it('mặc định page 1, limit 10; status tuỳ chọn; coerce từ chuỗi query', () => {
      expect(sellerRefundRequestListQuerySchema.parse({})).toEqual({
        page: 1,
        limit: 10,
      });
      expect(
        sellerRefundRequestListQuerySchema.parse({
          status: 'PENDING_SELLER',
          page: '2',
          limit: '25',
        }),
      ).toEqual({ status: 'PENDING_SELLER', page: 2, limit: 25 });
    });

    it('yêu cầu đã rút (WITHDRAWN) không bao giờ lọc được; limit tối đa 50', () => {
      expect(
        sellerRefundRequestListQuerySchema.safeParse({ status: 'WITHDRAWN' })
          .success,
      ).toBe(false);
      expect(
        sellerRefundRequestListQuerySchema.safeParse({ status: 'WEIRD' })
          .success,
      ).toBe(false);
      expect(
        sellerRefundRequestListQuerySchema.safeParse({ limit: '51' }).success,
      ).toBe(false);
    });
  });

  describe('sellerRefundRequestListItemSchema (Week9.md 2.7)', () => {
    it('yêu cầu đầy đủ + tóm tắt đơn (không userId/email của người mua), timeline không actorId', () => {
      const parsed = sellerRefundRequestListItemSchema.parse({
        id: 'r1',
        kind: 'RETURN',
        status: 'PENDING_SELLER',
        sellerRespondBy: '2026-10-03T10:00:00.000Z',
        reasonCode: 'DAMAGED',
        reasonNote: null,
        statusChangedAt: '2026-10-01T12:00:00.000Z',
        createdAt: '2026-10-01T12:00:00.000Z',
        history: [
          {
            toStatus: 'PENDING_SELLER',
            actorType: 'BUYER',
            note: null,
            createdAt: '2026-10-01T12:00:00.000Z',
            actorId: 'secret',
          },
        ],
        canApprove: true,
        canReject: true,
        order: {
          id: 'o1',
          status: 'COMPLETED',
          totalAmount: '220000',
          recipientName: 'Nguyễn Văn A',
          items: [item],
          itemCount: 1,
          paymentMethod: 'COD',
          paymentStatus: 'SUCCESS',
          userId: 'buyer-id',
          email: 'buyer@example.com',
        },
      });

      expect(parsed.history[0]).not.toHaveProperty('actorId');
      expect(parsed.order).not.toHaveProperty('userId');
      expect(parsed.order).not.toHaveProperty('email');
    });
  });

  describe('buyerNote (Week8.md 3B)', () => {
    const sellerDetail = {
      id: 'o1',
      status: 'PENDING',
      createdAt: '2026-10-01T10:00:00.000Z',
      totalAmount: '220000',
      recipientName: 'Nguyễn Văn A',
      shippingProvince: 'Hồ Chí Minh',
      items: [item],
      itemCount: 1,
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      canConfirm: true,
      canPack: false,
      canShip: false,
      canReject: true,
      canCancel: false,
      refundRequest: null,
      recipientPhone: '0912345678',
      shippingAddressLine: '12 Nguyễn Huệ',
      shippingWard: 'Phường Bến Nghé',
      subtotal: '200000',
      discountAmount: '0',
      shippingFee: '20000',
      carrier: null,
      trackingCode: null,
      history,
    };

    it('seller: danh sách và chi tiết đều mang buyerNote (chuỗi hoặc null)', () => {
      expect(
        sellerOrderListItemSchema.parse({
          ...sellerDetail,
          buyerNote: 'Gói quà',
        }).buyerNote,
      ).toBe('Gói quà');
      expect(
        sellerOrderListItemSchema.parse({ ...sellerDetail, buyerNote: null })
          .buyerNote,
      ).toBeNull();
      expect(
        sellerOrderDetailSchema.parse({ ...sellerDetail, buyerNote: 'Gói quà' })
          .buyerNote,
      ).toBe('Gói quà');
    });

    it('seller: thiếu buyerNote bị từ chối (BE phải trả null tường minh, không để undefined)', () => {
      expect(sellerOrderListItemSchema.safeParse(sellerDetail).success).toBe(
        false,
      );
      expect(sellerOrderDetailSchema.safeParse(sellerDetail).success).toBe(
        false,
      );
    });

    it('buyer: danh sách đơn KHÔNG có buyerNote (chỉ chi tiết) — schema tự bỏ nếu BE lỡ trả thừa', () => {
      const parsed = orderListItemSchema.parse({
        id: 'o1',
        checkoutGroupId: 'g1',
        status: 'PENDING',
        createdAt: '2026-10-01T10:00:00.000Z',
        totalAmount: '220000',
        shop: { id: 's1', name: 'Shop A', slug: 'shop-a', logoUrl: null },
        items: [item],
        itemCount: 1,
        paymentMethod: 'COD',
        paymentStatus: 'PENDING',
        canCancel: true,
        canRequestCancel: false,
        canRequestReturn: false,
        canConfirmReceived: false,
        canRetryPayment: false,
        refundRequest: null,
        refund: null,
        buyerNote: 'không nên lộ ở danh sách',
      });
      expect(parsed).not.toHaveProperty('buyerNote');
    });
  });

  it('sellerOrderDetailSchema không có userId/email của buyer (kể cả khi BE lỡ trả thừa)', () => {
    const parsed = sellerOrderDetailSchema.parse({
      id: 'o1',
      status: 'PENDING',
      createdAt: '2026-10-01T10:00:00.000Z',
      totalAmount: '220000',
      recipientName: 'Nguyễn Văn A',
      shippingProvince: 'Hồ Chí Minh',
      items: [item],
      itemCount: 1,
      paymentMethod: 'VNPAY',
      paymentStatus: 'SUCCESS',
      canConfirm: true,
      canPack: false,
      canShip: false,
      canReject: false,
      canCancel: false,
      refundRequest: null,
      recipientPhone: '0912345678',
      shippingAddressLine: '12 Nguyễn Huệ',
      shippingWard: 'Phường Bến Nghé',
      subtotal: '200000',
      discountAmount: '0',
      shippingFee: '20000',
      carrier: null,
      trackingCode: null,
      buyerNote: null,
      history,
      userId: 'buyer-id',
      email: 'buyer@example.com',
    });

    expect(parsed).not.toHaveProperty('userId');
    expect(parsed).not.toHaveProperty('email');
  });
});
