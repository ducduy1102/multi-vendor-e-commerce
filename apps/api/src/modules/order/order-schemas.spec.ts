import {
  cancelOrderSchema,
  ORDER_REASON_MAX_LENGTH,
  ORDER_SHIPPING_FIELD_MAX_LENGTH,
  ORDER_STATUSES_VISIBLE_TO_SELLER,
  ORDER_TAB_STATUSES,
  orderActorTypeSchema,
  orderDetailSchema,
  orderListItemSchema,
  orderListQuerySchema,
  orderStatusSchema,
  orderTabSchema,
  rejectOrderSchema,
  sellerOrderDetailSchema,
  sellerOrderListItemSchema,
  sellerOrderListQuerySchema,
  sellerOrderTabSchema,
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
    expect(parsed.paymentMethod).toBe('COD');
    // z.object tự bỏ field không khai — field phải có trong schema thì FE mới đọc được (general.md mục 4).
    expect(parsed.buyerNote).toBe('Giao giờ hành chính');
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
