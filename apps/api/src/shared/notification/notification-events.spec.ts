import {
  NOTIFICATION_LABEL_MAX_LENGTH,
  NOTIFICATION_REASON_MAX_LENGTH,
  notificationWriteSchema,
  type NotificationType,
  type OrderActorType,
} from '@ecommerce/types';
import {
  buildNotifications,
  type NotificationDraft,
  type NotificationEvent,
  type NotificationEventKind,
  type NotificationFacts,
  type OrderFacts,
  type RefundRequestFacts,
  type ReviewFacts,
  type ShopFacts,
} from './notification-events';

// Toàn bộ quyết định "AI nhận thông báo gì" nằm ở hàm thuần buildNotifications (Week10.md 7.3) nên kiểm thử bằng bảng:
// mỗi sự kiện × mỗi tình huống ⇒ đúng người nhận, đúng loại, đúng dữ liệu — và người KHÔNG được nhận thì thật sự không
// nhận (chặn gửi nhầm cho người mua/chủ shop/Admin). Ký tự đặc biệt dựng bằng String.fromCharCode.
const BUYER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const OTHER_OWNER = '33333333-3333-4333-8333-333333333333';
const ADMIN_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ADMIN_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const ORDER_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const ORDER_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const PRODUCT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SHOP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const APPEAL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const REQUEST = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const REVIEW = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const NUL = String.fromCharCode(0);
const BIDI = String.fromCharCode(0x202e);

const order = (overrides: Partial<OrderFacts> = {}): OrderFacts => ({
  orderId: ORDER_1,
  buyerId: BUYER,
  shopOwnerId: OWNER,
  shopName: 'Cửa hàng Ánh Dương',
  visibleToSeller: true,
  ...overrides,
});
const orders = (...list: OrderFacts[]): NotificationFacts => ({
  kind: 'ORDERS',
  orders: list,
});
const refundRequest = (
  overrides: Partial<RefundRequestFacts> = {},
  adminIds: string[] = [],
): NotificationFacts => ({
  kind: 'REFUND_REQUEST',
  request: {
    orderId: ORDER_1,
    kind: 'RETURN',
    buyerId: BUYER,
    shopOwnerId: OWNER,
    ...overrides,
  },
  adminIds,
});
const review = (overrides: Partial<ReviewFacts> = {}): NotificationFacts => ({
  kind: 'REVIEW',
  review: {
    productId: PRODUCT,
    productName: 'Áo thun cotton',
    rating: 4,
    reviewerId: BUYER,
    shopOwnerId: OWNER,
    shopName: 'Cửa hàng Ánh Dương',
    ...overrides,
  },
});
const shop = (
  overrides: Partial<ShopFacts> = {},
  adminIds: string[] = [],
): NotificationFacts => ({
  kind: 'SHOP',
  shop: {
    shopId: SHOP,
    shopName: 'Cửa hàng mới',
    ownerId: OWNER,
    ...overrides,
  },
  adminIds,
});

const recipientsOf = (drafts: NotificationDraft[]) =>
  drafts.map((d) => d.userId).sort();
const typesOf = (drafts: NotificationDraft[]) => drafts.map((d) => d.type);

describe('ORDERS_PLACED (đơn mới tới shop)', () => {
  const event: NotificationEvent = {
    kind: 'ORDERS_PLACED',
    checkoutGroupId: ORDER_2,
  };

  it('báo chủ shop của MỖI đơn, và người mua không nhận gì', () => {
    const drafts = buildNotifications(
      event,
      orders(
        order(),
        order({
          orderId: ORDER_2,
          shopOwnerId: OTHER_OWNER,
          shopName: 'Shop B',
        }),
      ),
    );

    expect(drafts).toEqual([
      { userId: OWNER, type: 'ORDER_NEW', data: { orderId: ORDER_1 } },
      { userId: OTHER_OWNER, type: 'ORDER_NEW', data: { orderId: ORDER_2 } },
    ]);
  });

  it('KHÔNG báo shop về đơn chưa từng vào PENDING (đơn online chưa thanh toán không được lộ cho shop)', () => {
    expect(
      buildNotifications(event, orders(order({ visibleToSeller: false }))),
    ).toEqual([]);
  });

  it('nhóm không có đơn nào ⇒ không có thông báo nào', () => {
    expect(buildNotifications(event, orders())).toEqual([]);
  });
});

describe('sự kiện đơn chỉ báo người mua', () => {
  it.each([
    ['ORDER_CONFIRMED', 'ORDER_CONFIRMED'],
    ['ORDER_SHIPPED', 'ORDER_SHIPPED'],
    ['ORDER_AUTO_COMPLETED', 'ORDER_COMPLETED'],
  ] as const)(
    '%s ⇒ người mua nhận %s với tên shop; chủ shop không nhận',
    (kind, type) => {
      const drafts = buildNotifications(
        { kind, orderId: ORDER_1 },
        orders(order()),
      );

      expect(drafts).toEqual([
        {
          userId: BUYER,
          type,
          data: { orderId: ORDER_1, shopName: 'Cửa hàng Ánh Dương' },
        },
      ]);
    },
  );

  it('REFUND_COMPLETED ⇒ người mua nhận mã đơn, không kèm số tiền', () => {
    expect(
      buildNotifications(
        { kind: 'REFUND_COMPLETED', orderId: ORDER_1 },
        orders(order()),
      ),
    ).toEqual([
      { userId: BUYER, type: 'REFUND_COMPLETED', data: { orderId: ORDER_1 } },
    ]);
  });

  it('tên shop quá dài / nhiều dòng / có ký tự lạ được cắt gọn thành nhãn hợp lệ', () => {
    const [draft] = buildNotifications(
      { kind: 'ORDER_CONFIRMED', orderId: ORDER_1 },
      orders(order({ shopName: `  Shop\n${NUL}${BIDI}${'漢'.repeat(200)}  ` })),
    );

    const shopName = (draft.data as { shopName: string }).shopName;
    expect(shopName.length).toBeLessThanOrEqual(NOTIFICATION_LABEL_MAX_LENGTH);
    expect(shopName.startsWith('Shop ')).toBe(true);
    expect(shopName.endsWith('…')).toBe(true);
    expect(shopName).not.toContain('\n');
  });
});

describe('ORDERS_CANCELLED (ai nhận khi đơn bị hủy)', () => {
  const cancelled = (
    by: OrderActorType,
    closedRefundRequest = false,
    reason?: string | null,
  ): NotificationEvent => ({
    kind: 'ORDERS_CANCELLED',
    target: { orderIds: [ORDER_1] },
    by,
    closedRefundRequest,
    reason,
  });

  // [ai hủy, hủy kèm duyệt yêu cầu, shop đã từng thấy đơn, người mua nhận, chủ shop nhận]
  it.each([
    ['BUYER', false, true, true, true],
    ['BUYER', false, false, true, false],
    ['SELLER', false, true, true, false],
    ['SYSTEM', false, true, true, true],
    ['SYSTEM', false, false, true, false],
    ['ADMIN', false, true, true, true],
    ['ADMIN', false, false, true, false],
    ['ADMIN', true, true, false, false],
    ['SELLER', true, true, false, false],
    ['SYSTEM', true, true, false, true],
    ['SYSTEM', true, false, false, false],
    ['BUYER', true, true, false, true],
  ] as const)(
    'hủy bởi %s, kèm duyệt yêu cầu=%s, shop đã thấy đơn=%s ⇒ người mua nhận=%s, chủ shop nhận=%s',
    (by, closed, visible, buyerGets, ownerGets) => {
      const drafts = buildNotifications(
        cancelled(by, closed),
        orders(order({ visibleToSeller: visible })),
      );

      expect(drafts.some((d) => d.userId === BUYER)).toBe(buyerGets);
      expect(drafts.some((d) => d.userId === OWNER)).toBe(ownerGets);
      expect(drafts).toHaveLength((buyerGets ? 1 : 0) + (ownerGets ? 1 : 0));
      expect(new Set(typesOf(drafts)).size).toBeLessThanOrEqual(1);
    },
  );

  it('mỗi phía nhận đúng audience và dữ liệu của mình', () => {
    const drafts = buildNotifications(
      cancelled('BUYER', false, 'Đổi ý'),
      orders(order()),
    );

    expect(drafts).toEqual([
      {
        userId: BUYER,
        type: 'ORDER_CANCELLED',
        data: {
          orderId: ORDER_1,
          audience: 'BUYER',
          by: 'BUYER',
          shopName: 'Cửa hàng Ánh Dương',
          reason: 'Đổi ý',
        },
      },
      {
        userId: OWNER,
        type: 'ORDER_CANCELLED',
        data: {
          orderId: ORDER_1,
          audience: 'SELLER',
          by: 'BUYER',
          shopName: 'Cửa hàng Ánh Dương',
          reason: 'Đổi ý',
        },
      },
    ]);
  });

  it('nhóm nhiều đơn ⇒ mỗi đơn một thông báo cho mỗi phía (mỗi cái trỏ đúng đơn của nó)', () => {
    const drafts = buildNotifications(
      {
        kind: 'ORDERS_CANCELLED',
        target: { checkoutGroupId: ORDER_2 },
        by: 'BUYER',
      },
      orders(order(), order({ orderId: ORDER_2, shopOwnerId: OTHER_OWNER })),
    );

    expect(drafts).toHaveLength(4);
    expect(
      drafts
        .filter((d) => d.userId === BUYER)
        .map((d) => (d.data as { orderId: string }).orderId),
    ).toEqual([ORDER_1, ORDER_2]);
    expect(recipientsOf(drafts)).toEqual(
      [BUYER, BUYER, OWNER, OTHER_OWNER].sort(),
    );
  });

  describe('lý do', () => {
    const reasonOf = (reason: string | null | undefined) => {
      const [draft] = buildNotifications(
        cancelled('SELLER', false, reason),
        orders(order()),
      );
      return (draft.data as { reason?: string }).reason;
    };

    it('lý do ngắn được giữ nguyên', () => {
      expect(reasonOf('Hết hàng')).toBe('Hết hàng');
    });

    it('lý do dài bị cắt về đúng giới hạn và kết thúc bằng …', () => {
      const reason = reasonOf('a'.repeat(500)) as string;

      expect(reason).toHaveLength(NOTIFICATION_REASON_MAX_LENGTH);
      expect(reason.endsWith('…')).toBe(true);
    });

    it('lý do nhiều dòng thành một dòng', () => {
      expect(reasonOf('Dòng 1\n\nDòng 2\tcuối')).toBe('Dòng 1 Dòng 2 cuối');
    });

    it.each([[undefined], [null], [''], ['   \n\t '], [`${NUL}`]])(
      'lý do %j ⇒ bỏ hẳn khoá reason',
      (value) => {
        expect(reasonOf(value)).toBeUndefined();
        const [draft] = buildNotifications(
          cancelled('SELLER', false, value),
          orders(order()),
        );
        expect('reason' in draft.data).toBe(false);
      },
    );
  });
});

describe('sự kiện yêu cầu hủy / trả hàng', () => {
  it('REFUND_REQUEST_CREATED ⇒ chỉ chủ shop nhận, kèm loại yêu cầu', () => {
    expect(
      buildNotifications(
        { kind: 'REFUND_REQUEST_CREATED', refundRequestId: REQUEST },
        refundRequest({ kind: 'CANCEL' }),
      ),
    ).toEqual([
      {
        userId: OWNER,
        type: 'REFUND_REQUEST_NEW',
        data: { orderId: ORDER_1, kind: 'CANCEL' },
      },
    ]);
  });

  it('REFUND_REQUEST_APPROVED ⇒ chỉ người mua nhận', () => {
    expect(
      buildNotifications(
        { kind: 'REFUND_REQUEST_APPROVED', refundRequestId: REQUEST },
        refundRequest(),
      ),
    ).toEqual([
      {
        userId: BUYER,
        type: 'REFUND_REQUEST_APPROVED',
        data: { orderId: ORDER_1, kind: 'RETURN' },
      },
    ]);
  });

  it('REFUND_REQUEST_REJECTED ⇒ chỉ người mua nhận, kèm lý do đã cắt gọn (nếu có)', () => {
    const withReason = buildNotifications(
      {
        kind: 'REFUND_REQUEST_REJECTED',
        refundRequestId: REQUEST,
        reason: '  Sản phẩm đã qua sử dụng  ',
      },
      refundRequest(),
    );
    const without = buildNotifications(
      { kind: 'REFUND_REQUEST_REJECTED', refundRequestId: REQUEST },
      refundRequest(),
    );

    expect(withReason).toEqual([
      {
        userId: BUYER,
        type: 'REFUND_REQUEST_REJECTED',
        data: {
          orderId: ORDER_1,
          kind: 'RETURN',
          reason: 'Sản phẩm đã qua sử dụng',
        },
      },
    ]);
    expect(without[0].data).toEqual({ orderId: ORDER_1, kind: 'RETURN' });
  });

  describe('REFUND_REQUEST_ESCALATED', () => {
    const event: NotificationEvent = {
      kind: 'REFUND_REQUEST_ESCALATED',
      refundRequestId: REQUEST,
    };

    it('tất cả Admin nhận (audience ADMIN) và chủ shop nhận (audience SELLER); người mua không nhận', () => {
      const drafts = buildNotifications(
        event,
        refundRequest({}, [ADMIN_1, ADMIN_2]),
      );

      expect(drafts).toEqual([
        {
          userId: ADMIN_1,
          type: 'REFUND_REQUEST_ESCALATED',
          data: { orderId: ORDER_1, kind: 'RETURN', audience: 'ADMIN' },
        },
        {
          userId: ADMIN_2,
          type: 'REFUND_REQUEST_ESCALATED',
          data: { orderId: ORDER_1, kind: 'RETURN', audience: 'ADMIN' },
        },
        {
          userId: OWNER,
          type: 'REFUND_REQUEST_ESCALATED',
          data: { orderId: ORDER_1, kind: 'RETURN', audience: 'SELLER' },
        },
      ]);
    });

    it('không có Admin nào ⇒ chủ shop vẫn được báo', () => {
      expect(buildNotifications(event, refundRequest({}, []))).toHaveLength(1);
    });

    it('một Admin xuất hiện hai lần trong danh sách chỉ nhận một thông báo', () => {
      const drafts = buildNotifications(
        event,
        refundRequest({}, [ADMIN_1, ADMIN_1]),
      );

      expect(drafts.filter((d) => d.userId === ADMIN_1)).toHaveLength(1);
    });

    it('người vừa là Admin vừa là chủ shop nhận CẢ HAI thông báo (đường dẫn đích khác nhau)', () => {
      const drafts = buildNotifications(
        event,
        refundRequest({ shopOwnerId: ADMIN_1 }, [ADMIN_1]),
      );

      expect(
        drafts
          .filter((d) => d.userId === ADMIN_1)
          .map((d) => (d.data as { audience: string }).audience)
          .sort(),
      ).toEqual(['ADMIN', 'SELLER']);
    });
  });

  it.each(['APPROVED', 'REJECTED'] as const)(
    'REFUND_REQUEST_DECIDED_BY_ADMIN (%s) ⇒ chỉ chủ shop nhận',
    (outcome) => {
      expect(
        buildNotifications(
          {
            kind: 'REFUND_REQUEST_DECIDED_BY_ADMIN',
            refundRequestId: REQUEST,
            outcome,
          },
          refundRequest({ kind: 'CANCEL' }),
        ),
      ).toEqual([
        {
          userId: OWNER,
          type: 'REFUND_REQUEST_DECIDED_BY_ADMIN',
          data: { orderId: ORDER_1, kind: 'CANCEL', outcome },
        },
      ]);
    },
  );
});

describe('sự kiện đánh giá', () => {
  it('REVIEW_CREATED ⇒ chỉ chủ shop nhận, kèm điểm và tên sản phẩm', () => {
    expect(
      buildNotifications(
        { kind: 'REVIEW_CREATED', reviewId: REVIEW },
        review(),
      ),
    ).toEqual([
      {
        userId: OWNER,
        type: 'REVIEW_NEW',
        data: { productId: PRODUCT, productName: 'Áo thun cotton', rating: 4 },
      },
    ]);
  });

  it('REVIEW_REPLIED ⇒ chỉ tác giả đánh giá nhận, kèm tên shop; chủ shop (người trả lời) không nhận', () => {
    expect(
      buildNotifications(
        { kind: 'REVIEW_REPLIED', reviewId: REVIEW },
        review(),
      ),
    ).toEqual([
      {
        userId: BUYER,
        type: 'REVIEW_REPLIED',
        data: {
          productId: PRODUCT,
          productName: 'Áo thun cotton',
          shopName: 'Cửa hàng Ánh Dương',
        },
      },
    ]);
  });

  it('tên sản phẩm dài bị cắt về nhãn', () => {
    const [draft] = buildNotifications(
      { kind: 'REVIEW_CREATED', reviewId: REVIEW },
      review({ productName: 'x'.repeat(300) }),
    );

    expect((draft.data as { productName: string }).productName).toHaveLength(
      NOTIFICATION_LABEL_MAX_LENGTH,
    );
  });
});

describe('sự kiện shop', () => {
  it('SHOP_STATUS_CHANGED ⇒ chỉ chủ shop nhận, kèm trạng thái và lý do (nếu có)', () => {
    expect(
      buildNotifications(
        {
          kind: 'SHOP_STATUS_CHANGED',
          shopId: SHOP,
          status: 'SUSPENDED',
          reason: 'Vi phạm chính sách',
        },
        shop({}, [ADMIN_1]),
      ),
    ).toEqual([
      {
        userId: OWNER,
        type: 'SHOP_STATUS_CHANGED',
        data: {
          shopId: SHOP,
          status: 'SUSPENDED',
          reason: 'Vi phạm chính sách',
        },
      },
    ]);
    expect(
      buildNotifications(
        { kind: 'SHOP_STATUS_CHANGED', shopId: SHOP, status: 'APPROVED' },
        shop(),
      )[0].data,
    ).toEqual({ shopId: SHOP, status: 'APPROVED' });
  });

  it('SHOP_SUBMITTED ⇒ chỉ Admin nhận (không phải chủ shop), mỗi Admin một thông báo', () => {
    expect(
      buildNotifications(
        { kind: 'SHOP_SUBMITTED', shopId: SHOP },
        shop({}, [ADMIN_1, ADMIN_2]),
      ),
    ).toEqual([
      {
        userId: ADMIN_1,
        type: 'ADMIN_SHOP_PENDING',
        data: { shopId: SHOP, shopName: 'Cửa hàng mới' },
      },
      {
        userId: ADMIN_2,
        type: 'ADMIN_SHOP_PENDING',
        data: { shopId: SHOP, shopName: 'Cửa hàng mới' },
      },
    ]);
  });

  it('SHOP_SUBMITTED khi không có Admin nào ⇒ không có thông báo', () => {
    expect(
      buildNotifications(
        { kind: 'SHOP_SUBMITTED', shopId: SHOP },
        shop({}, []),
      ),
    ).toEqual([]);
  });

  // Kháng nghị (Week11.md 4.6): thông báo chỉ mang id (+ tên shop đã cắt gọn / kết quả), không bao giờ lời kháng nghị hay lý do.
  it('APPEAL_SUBMITTED ⇒ mọi Admin nhận ADMIN_APPEAL_PENDING (chủ shop thì không), kèm id kháng nghị và tên shop', () => {
    expect(
      buildNotifications(
        { kind: 'APPEAL_SUBMITTED', appealId: APPEAL, shopId: SHOP },
        shop({}, [ADMIN_1, ADMIN_2]),
      ),
    ).toEqual([
      {
        userId: ADMIN_1,
        type: 'ADMIN_APPEAL_PENDING',
        data: { appealId: APPEAL, shopId: SHOP, shopName: 'Cửa hàng mới' },
      },
      {
        userId: ADMIN_2,
        type: 'ADMIN_APPEAL_PENDING',
        data: { appealId: APPEAL, shopId: SHOP, shopName: 'Cửa hàng mới' },
      },
    ]);
  });

  it('APPEAL_SUBMITTED khi không có Admin nào ⇒ không có thông báo', () => {
    expect(
      buildNotifications(
        { kind: 'APPEAL_SUBMITTED', appealId: APPEAL, shopId: SHOP },
        shop({}, []),
      ),
    ).toEqual([]);
  });

  it.each(['ACCEPTED', 'REJECTED'] as const)(
    'APPEAL_DECIDED (%s) ⇒ chỉ chủ shop nhận APPEAL_DECIDED, người nhận suy từ shop chứ không từ sự kiện, không có Admin nào',
    (decision) => {
      expect(
        buildNotifications(
          { kind: 'APPEAL_DECIDED', appealId: APPEAL, shopId: SHOP, decision },
          shop({}, [ADMIN_1]),
        ),
      ).toEqual([
        {
          userId: OWNER,
          type: 'APPEAL_DECIDED',
          data: { appealId: APPEAL, shopId: SHOP, decision },
        },
      ]);
    },
  );
});

describe('tính đúng đắn chung', () => {
  // Một ví dụ cho MỖI loại sự kiện: kiểu Record<NotificationEventKind, ...> khiến thêm loại mà quên ví dụ là lỗi biên dịch.
  const SAMPLES: Record<
    NotificationEventKind,
    { event: NotificationEvent; facts: NotificationFacts }
  > = {
    ORDERS_PLACED: {
      event: { kind: 'ORDERS_PLACED', checkoutGroupId: ORDER_2 },
      facts: orders(order()),
    },
    ORDER_CONFIRMED: {
      event: { kind: 'ORDER_CONFIRMED', orderId: ORDER_1 },
      facts: orders(order()),
    },
    ORDER_SHIPPED: {
      event: { kind: 'ORDER_SHIPPED', orderId: ORDER_1 },
      facts: orders(order()),
    },
    ORDER_AUTO_COMPLETED: {
      event: { kind: 'ORDER_AUTO_COMPLETED', orderId: ORDER_1 },
      facts: orders(order()),
    },
    ORDERS_CANCELLED: {
      event: {
        kind: 'ORDERS_CANCELLED',
        target: { orderIds: [ORDER_1] },
        by: 'BUYER',
        reason: 'Đổi ý',
      },
      facts: orders(order()),
    },
    REFUND_REQUEST_CREATED: {
      event: { kind: 'REFUND_REQUEST_CREATED', refundRequestId: REQUEST },
      facts: refundRequest(),
    },
    REFUND_REQUEST_APPROVED: {
      event: { kind: 'REFUND_REQUEST_APPROVED', refundRequestId: REQUEST },
      facts: refundRequest(),
    },
    REFUND_REQUEST_REJECTED: {
      event: {
        kind: 'REFUND_REQUEST_REJECTED',
        refundRequestId: REQUEST,
        reason: 'Không đủ điều kiện',
      },
      facts: refundRequest(),
    },
    REFUND_REQUEST_ESCALATED: {
      event: { kind: 'REFUND_REQUEST_ESCALATED', refundRequestId: REQUEST },
      facts: refundRequest({}, [ADMIN_1]),
    },
    REFUND_REQUEST_DECIDED_BY_ADMIN: {
      event: {
        kind: 'REFUND_REQUEST_DECIDED_BY_ADMIN',
        refundRequestId: REQUEST,
        outcome: 'APPROVED',
      },
      facts: refundRequest(),
    },
    REFUND_COMPLETED: {
      event: { kind: 'REFUND_COMPLETED', orderId: ORDER_1 },
      facts: orders(order()),
    },
    REVIEW_CREATED: {
      event: { kind: 'REVIEW_CREATED', reviewId: REVIEW },
      facts: review(),
    },
    REVIEW_REPLIED: {
      event: { kind: 'REVIEW_REPLIED', reviewId: REVIEW },
      facts: review(),
    },
    SHOP_STATUS_CHANGED: {
      event: {
        kind: 'SHOP_STATUS_CHANGED',
        shopId: SHOP,
        status: 'REJECTED',
        reason: 'Thiếu giấy tờ',
      },
      facts: shop(),
    },
    SHOP_SUBMITTED: {
      event: { kind: 'SHOP_SUBMITTED', shopId: SHOP },
      facts: shop({}, [ADMIN_1]),
    },
    APPEAL_SUBMITTED: {
      event: { kind: 'APPEAL_SUBMITTED', appealId: APPEAL, shopId: SHOP },
      facts: shop({}, [ADMIN_1]),
    },
    APPEAL_DECIDED: {
      event: {
        kind: 'APPEAL_DECIDED',
        appealId: APPEAL,
        shopId: SHOP,
        decision: 'ACCEPTED',
      },
      facts: shop(),
    },
  };

  const KINDS = Object.keys(SAMPLES) as NotificationEventKind[];

  it.each(KINDS.map((kind) => [kind]))(
    '%s: mọi thông báo sinh ra đều qua schema ghi và có ít nhất một người nhận',
    (kind) => {
      const { event, facts } = SAMPLES[kind];

      const drafts = buildNotifications(event, facts);

      expect(drafts.length).toBeGreaterThan(0);
      for (const draft of drafts) {
        expect(
          notificationWriteSchema.safeParse({
            type: draft.type,
            data: draft.data,
          }).success,
        ).toBe(true);
      }
    },
  );

  it.each(KINDS.map((kind) => [kind]))(
    '%s: người nhận chỉ lấy từ dữ kiện đã tải (không phải từ sự kiện)',
    (kind) => {
      const { event, facts } = SAMPLES[kind];
      const known = new Set<string>();
      if (facts.kind === 'ORDERS')
        facts.orders.forEach((o) => {
          known.add(o.buyerId);
          known.add(o.shopOwnerId);
        });
      if (facts.kind === 'REFUND_REQUEST') {
        known.add(facts.request.buyerId);
        known.add(facts.request.shopOwnerId);
        facts.adminIds.forEach((id) => known.add(id));
      }
      if (facts.kind === 'REVIEW') {
        known.add(facts.review.reviewerId);
        known.add(facts.review.shopOwnerId);
      }
      if (facts.kind === 'SHOP') {
        known.add(facts.shop.ownerId);
        facts.adminIds.forEach((id) => known.add(id));
      }

      for (const draft of buildNotifications(event, facts)) {
        expect(known.has(draft.userId)).toBe(true);
      }
      // Sự kiện không mang trường người dùng nào nên không thể là nguồn của người nhận.
      expect(JSON.stringify(event)).not.toMatch(
        /userId|buyerId|ownerId|recipient/i,
      );
    },
  );

  it.each(KINDS.map((kind) => [kind]))(
    '%s: ca xấu nhất về chữ (tên và lý do cực dài, nhiều dòng, ký tự lạ) vẫn qua schema ghi và dưới 1024 byte',
    (kind) => {
      const nasty = `  ${'漢'.repeat(300)}\n${NUL}${BIDI}\t${'😀'.repeat(200)}  `;
      const { event, facts } = SAMPLES[kind];
      const nastyEvent = {
        ...event,
        ...('reason' in event ? { reason: nasty } : {}),
      } as NotificationEvent;
      const nastyFacts: NotificationFacts =
        facts.kind === 'ORDERS'
          ? orders(...facts.orders.map((o) => ({ ...o, shopName: nasty })))
          : facts.kind === 'REVIEW'
            ? review({ productName: nasty, shopName: nasty })
            : facts.kind === 'SHOP'
              ? shop({ shopName: nasty }, facts.adminIds)
              : facts;

      for (const draft of buildNotifications(nastyEvent, nastyFacts)) {
        expect(
          notificationWriteSchema.safeParse({
            type: draft.type,
            data: draft.data,
          }).success,
        ).toBe(true);
      }
    },
  );

  it('thuần: không đổi dữ kiện đầu vào và cho cùng kết quả khi gọi lại', () => {
    const { event, facts } = SAMPLES.ORDERS_CANCELLED;
    const snapshot = JSON.stringify(facts);

    const first = buildNotifications(event, facts);
    const second = buildNotifications(event, facts);

    expect(JSON.stringify(facts)).toBe(snapshot);
    expect(second).toEqual(first);
  });

  it('dữ kiện sai loại cho sự kiện ⇒ ném lỗi rõ ràng (service sẽ bắt và log, không gửi gì)', () => {
    expect(() =>
      buildNotifications(
        { kind: 'REVIEW_CREATED', reviewId: REVIEW },
        orders(order()),
      ),
    ).toThrow(/needs REVIEW facts, got ORDERS/);
    expect(() =>
      buildNotifications({ kind: 'ORDER_CONFIRMED', orderId: ORDER_1 }, shop()),
    ).toThrow(/needs ORDERS facts, got SHOP/);
  });

  it('cùng người nhận + cùng nội dung chỉ giữ một', () => {
    const types = new Set<NotificationType>();
    const drafts = buildNotifications(
      { kind: 'ORDER_CONFIRMED', orderId: ORDER_1 },
      orders(order(), order()),
    );

    drafts.forEach((d) => types.add(d.type));
    expect(drafts).toHaveLength(1);
  });
});
