import {
  parseReportSnapshot,
  REPORT_SNAPSHOT_MAX_BYTES,
  REPORT_SNAPSHOT_NAME_MAX_LENGTH,
  REPORT_TARGET_TYPES,
} from '@ecommerce/types';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { PrismaReportTargetDirectory } from './prisma-report-target-directory';

// Quyết định "người báo có thấy được đối tượng không / có phải của họ không" và hình dạng ảnh chụp (Week11.md 5.3). Dữ liệu thật
// trên Postgres do report.controller.int-spec.ts kiểm; ở đây khoá luật và các `select` hẹp (không email/SĐT/nội dung tin).
const REPORTER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const ID = '44444444-4444-4444-8444-444444444444';
const PRODUCT_ID = '55555555-5555-4555-8555-555555555555';

function setup() {
  const prisma = {
    review: { findUnique: jest.fn() },
    conversation: { findUnique: jest.fn() },
    shop: { findUnique: jest.fn() },
    product: { findUnique: jest.fn() },
  };
  const directory = new PrismaReportTargetDirectory(
    prisma as unknown as PrismaService,
  );
  return { directory, prisma };
}

const reviewRow = (overrides: Record<string, unknown> = {}) => ({
  userId: STRANGER,
  rating: 1,
  comment: 'Hàng giả',
  user: { name: 'Nguyễn Văn A' },
  product: {
    id: PRODUCT_ID,
    name: 'Áo thun',
    status: 'PUBLISHED',
    shop: { ownerId: OWNER, status: 'APPROVED' },
  },
  ...overrides,
});

const productRow = (overrides: Record<string, unknown> = {}) => ({
  name: 'Áo thun',
  status: 'PUBLISHED',
  shop: { ownerId: OWNER, status: 'APPROVED', name: 'Shop A' },
  ...overrides,
});

const conversationRow = (overrides: Record<string, unknown> = {}) => ({
  buyerId: REPORTER,
  lastMessageAt: new Date('2026-10-30T10:00:00.000Z'),
  buyer: { name: 'Trần B' },
  shop: { ownerId: OWNER, name: 'Shop A' },
  ...overrides,
});

describe('REVIEW', () => {
  it('đánh giá của sản phẩm đang bán công khai: người ngoài báo được, ảnh chụp có nguyên văn đánh giá', async () => {
    const { directory, prisma } = setup();
    prisma.review.findUnique.mockResolvedValue(reviewRow());

    const result = await directory.resolve(REPORTER, 'REVIEW', ID);

    expect(result).toEqual({
      ownedByReporter: false,
      snapshot: {
        productId: PRODUCT_ID,
        productName: 'Áo thun',
        rating: 1,
        comment: 'Hàng giả',
        authorName: 'Nguyễn Văn A',
      },
    });
  });

  it('không tồn tại ⇒ null', async () => {
    const { directory, prisma } = setup();
    prisma.review.findUnique.mockResolvedValue(null);

    await expect(directory.resolve(REPORTER, 'REVIEW', ID)).resolves.toBeNull();
  });

  it.each([
    ['sản phẩm nháp', { status: 'DRAFT' }],
    ['sản phẩm đã lưu trữ', { status: 'ARCHIVED' }],
  ])(
    '%s: người ngoài không thấy đánh giá ⇒ null',
    async (_name, productOverrides) => {
      const { directory, prisma } = setup();
      prisma.review.findUnique.mockResolvedValue(
        reviewRow({
          product: { ...reviewRow().product, ...productOverrides },
        }),
      );

      await expect(
        directory.resolve(REPORTER, 'REVIEW', ID),
      ).resolves.toBeNull();
    },
  );

  it('shop chưa/không còn APPROVED: người ngoài không thấy đánh giá ⇒ null', async () => {
    const { directory, prisma } = setup();
    prisma.review.findUnique.mockResolvedValue(
      reviewRow({
        product: {
          ...reviewRow().product,
          shop: { ownerId: OWNER, status: 'SUSPENDED' },
        },
      }),
    );

    await expect(directory.resolve(REPORTER, 'REVIEW', ID)).resolves.toBeNull();
  });

  it('chủ shop của sản phẩm vẫn thấy đánh giá khi sản phẩm không còn công khai (đánh giá nằm trong hàng của họ)', async () => {
    const { directory, prisma } = setup();
    prisma.review.findUnique.mockResolvedValue(
      reviewRow({
        product: { ...reviewRow().product, status: 'ARCHIVED' },
      }),
    );

    const result = await directory.resolve(OWNER, 'REVIEW', ID);

    expect(result).not.toBeNull();
    expect(result?.ownedByReporter).toBe(false);
  });

  it('tác giả đánh giá ⇒ ownedByReporter (không tự báo đánh giá của mình)', async () => {
    const { directory, prisma } = setup();
    prisma.review.findUnique.mockResolvedValue(reviewRow({ userId: REPORTER }));

    const result = await directory.resolve(REPORTER, 'REVIEW', ID);

    expect(result?.ownedByReporter).toBe(true);
  });

  it('đánh giá chỉ có sao: comment null', async () => {
    const { directory, prisma } = setup();
    prisma.review.findUnique.mockResolvedValue(reviewRow({ comment: null }));

    const result = await directory.resolve(REPORTER, 'REVIEW', ID);

    expect(result?.snapshot).toMatchObject({ comment: null });
  });

  it('select hẹp: không email/SĐT của tác giả, chỉ tên', async () => {
    const { directory, prisma } = setup();
    prisma.review.findUnique.mockResolvedValue(reviewRow());

    await directory.resolve(REPORTER, 'REVIEW', ID);

    const args = prisma.review.findUnique.mock.calls[0] as [
      { select: Record<string, unknown> },
    ];
    expect(args[0].select.user).toEqual({ select: { name: true } });
    expect(JSON.stringify(args[0].select)).not.toMatch(/email|phone|password/i);
  });

  it('đánh giá 1.000 ký tự điều khiển (JSON hoá thành \\u0001 = 6 byte mỗi ký tự) vẫn thành ảnh chụp VỪA trần byte, không bị từ chối', async () => {
    const { directory, prisma } = setup();
    const nasty = String.fromCharCode(1).repeat(1000);
    prisma.review.findUnique.mockResolvedValue(reviewRow({ comment: nasty }));

    const result = await directory.resolve(REPORTER, 'REVIEW', ID);

    expect(
      Buffer.byteLength(JSON.stringify(result?.snapshot)),
    ).toBeLessThanOrEqual(REPORT_SNAPSHOT_MAX_BYTES);
    expect(() => parseReportSnapshot('REVIEW', result?.snapshot)).not.toThrow();
  });

  it('đánh giá dài bình thường (1.000 ký tự tiếng Việt) được giữ NGUYÊN VĂN', async () => {
    const { directory, prisma } = setup();
    const long = 'ệ'.repeat(1000);
    prisma.review.findUnique.mockResolvedValue(reviewRow({ comment: long }));

    const result = await directory.resolve(REPORTER, 'REVIEW', ID);

    expect(result?.snapshot).toMatchObject({ comment: long });
  });

  it('tên quá dài hoặc nhiều dòng bị gọn về một dòng trong giới hạn của ảnh chụp', async () => {
    const { directory, prisma } = setup();
    prisma.review.findUnique.mockResolvedValue(
      reviewRow({
        user: { name: 'A\nB' },
        product: {
          ...reviewRow().product,
          name: 'x'.repeat(REPORT_SNAPSHOT_NAME_MAX_LENGTH * 3),
        },
      }),
    );

    const result = await directory.resolve(REPORTER, 'REVIEW', ID);
    const snapshot = parseReportSnapshot('REVIEW', result?.snapshot);

    expect(snapshot.authorName).toBe('A B');
    expect(snapshot.productName.length).toBeLessThanOrEqual(
      REPORT_SNAPSHOT_NAME_MAX_LENGTH,
    );
  });
});

describe('CONVERSATION', () => {
  it('người mua báo: vai BUYER, ảnh chụp chỉ có tên hai bên và vai', async () => {
    const { directory, prisma } = setup();
    prisma.conversation.findUnique.mockResolvedValue(conversationRow());

    const result = await directory.resolve(REPORTER, 'CONVERSATION', ID);

    expect(result).toEqual({
      ownedByReporter: false,
      snapshot: {
        shopName: 'Shop A',
        buyerName: 'Trần B',
        reporterRole: 'BUYER',
      },
    });
  });

  it('chủ shop báo: vai SHOP', async () => {
    const { directory, prisma } = setup();
    prisma.conversation.findUnique.mockResolvedValue(conversationRow());

    const result = await directory.resolve(OWNER, 'CONVERSATION', ID);

    expect(result?.snapshot).toMatchObject({ reporterRole: 'SHOP' });
    expect(result?.ownedByReporter).toBe(false);
  });

  it('người ngoài hội thoại ⇒ null (cùng kết quả với hội thoại không tồn tại)', async () => {
    const { directory, prisma } = setup();
    prisma.conversation.findUnique.mockResolvedValue(conversationRow());
    const stranger = await directory.resolve(STRANGER, 'CONVERSATION', ID);
    prisma.conversation.findUnique.mockResolvedValue(null);
    const missing = await directory.resolve(STRANGER, 'CONVERSATION', ID);

    expect(stranger).toBeNull();
    expect(missing).toBeNull();
  });

  it('hội thoại chưa có tin nào (không hiện ở cả hai phía) ⇒ null', async () => {
    const { directory, prisma } = setup();
    prisma.conversation.findUnique.mockResolvedValue(
      conversationRow({ lastMessageAt: null }),
    );

    await expect(
      directory.resolve(REPORTER, 'CONVERSATION', ID),
    ).resolves.toBeNull();
  });

  it('shop đã bị khoá vẫn báo được (hội thoại chỉ-đọc)', async () => {
    const { directory, prisma } = setup();
    prisma.conversation.findUnique.mockResolvedValue(
      conversationRow({
        shop: { ownerId: OWNER, name: 'Shop A', status: 'SUSPENDED' },
      }),
    );

    await expect(
      directory.resolve(REPORTER, 'CONVERSATION', ID),
    ).resolves.not.toBeNull();
  });

  it('một người vừa là người mua vừa là chủ shop của hội thoại được coi là người mua', async () => {
    const { directory, prisma } = setup();
    prisma.conversation.findUnique.mockResolvedValue(
      conversationRow({ buyerId: OWNER }),
    );

    const result = await directory.resolve(OWNER, 'CONVERSATION', ID);

    expect(result?.snapshot).toMatchObject({ reporterRole: 'BUYER' });
  });

  it('KHÔNG BAO GIỜ đọc nội dung tin nhắn: select không có messages/content, và ảnh chụp không có khoá nào ngoài ba khoá cho phép', async () => {
    const { directory, prisma } = setup();
    prisma.conversation.findUnique.mockResolvedValue(
      conversationRow({
        messages: [{ content: 'CANARY-NOI-DUNG-TIN-NHAN' }],
        content: 'CANARY-NOI-DUNG-TIN-NHAN',
      }),
    );

    const result = await directory.resolve(REPORTER, 'CONVERSATION', ID);

    const args = prisma.conversation.findUnique.mock.calls[0] as [
      { select: Record<string, unknown> },
    ];
    expect(Object.keys(args[0].select).sort()).toEqual([
      'buyer',
      'buyerId',
      'lastMessageAt',
      'shop',
    ]);
    expect(JSON.stringify(args[0].select)).not.toMatch(
      /messages|content|email|phone/i,
    );
    expect(Object.keys(result?.snapshot ?? {}).sort()).toEqual([
      'buyerName',
      'reporterRole',
      'shopName',
    ]);
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });
});

describe('SHOP', () => {
  const shopRow = (overrides: Record<string, unknown> = {}) => ({
    ownerId: OWNER,
    status: 'APPROVED',
    name: 'Shop A',
    slug: 'shop-a',
    ...overrides,
  });

  it('shop đang công khai: người ngoài báo được, ảnh chụp có tên và slug', async () => {
    const { directory, prisma } = setup();
    prisma.shop.findUnique.mockResolvedValue(shopRow());

    await expect(directory.resolve(REPORTER, 'SHOP', ID)).resolves.toEqual({
      ownedByReporter: false,
      snapshot: { name: 'Shop A', slug: 'shop-a' },
    });
  });

  it('chủ shop ⇒ ownedByReporter', async () => {
    const { directory, prisma } = setup();
    prisma.shop.findUnique.mockResolvedValue(shopRow());

    const result = await directory.resolve(OWNER, 'SHOP', ID);

    expect(result?.ownedByReporter).toBe(true);
  });

  it.each(['PENDING', 'REJECTED', 'SUSPENDED'])(
    'shop %s không công khai ⇒ null — kể cả với chính chủ (không dò được trạng thái qua mã lỗi)',
    async (status) => {
      const { directory, prisma } = setup();
      prisma.shop.findUnique.mockResolvedValue(shopRow({ status }));

      await expect(directory.resolve(REPORTER, 'SHOP', ID)).resolves.toBeNull();
      await expect(directory.resolve(OWNER, 'SHOP', ID)).resolves.toBeNull();
    },
  );

  it('không tồn tại ⇒ null', async () => {
    const { directory, prisma } = setup();
    prisma.shop.findUnique.mockResolvedValue(null);

    await expect(directory.resolve(REPORTER, 'SHOP', ID)).resolves.toBeNull();
  });

  it('select hẹp: không lấy email/SĐT hay thông tin riêng của chủ shop', async () => {
    const { directory, prisma } = setup();
    prisma.shop.findUnique.mockResolvedValue(shopRow());

    await directory.resolve(REPORTER, 'SHOP', ID);

    const args = prisma.shop.findUnique.mock.calls[0] as [
      { select: Record<string, boolean> },
    ];
    expect(Object.keys(args[0].select).sort()).toEqual([
      'name',
      'ownerId',
      'slug',
      'status',
    ]);
  });
});

describe('PRODUCT', () => {
  it('sản phẩm PUBLISHED của shop APPROVED: người ngoài báo được, ảnh chụp có tên sản phẩm và tên shop (không slug)', async () => {
    const { directory, prisma } = setup();
    prisma.product.findUnique.mockResolvedValue(productRow());

    await expect(directory.resolve(REPORTER, 'PRODUCT', ID)).resolves.toEqual({
      ownedByReporter: false,
      snapshot: { name: 'Áo thun', shopName: 'Shop A' },
    });
  });

  it('chủ shop ⇒ ownedByReporter', async () => {
    const { directory, prisma } = setup();
    prisma.product.findUnique.mockResolvedValue(productRow());

    const result = await directory.resolve(OWNER, 'PRODUCT', ID);

    expect(result?.ownedByReporter).toBe(true);
  });

  it.each(['DRAFT', 'ARCHIVED'])(
    'sản phẩm %s không công khai ⇒ null',
    async (status) => {
      const { directory, prisma } = setup();
      prisma.product.findUnique.mockResolvedValue(productRow({ status }));

      await expect(
        directory.resolve(REPORTER, 'PRODUCT', ID),
      ).resolves.toBeNull();
    },
  );

  it('shop không APPROVED ⇒ null dù sản phẩm PUBLISHED', async () => {
    const { directory, prisma } = setup();
    prisma.product.findUnique.mockResolvedValue(
      productRow({
        shop: { ownerId: OWNER, status: 'PENDING', name: 'Shop A' },
      }),
    );

    await expect(
      directory.resolve(REPORTER, 'PRODUCT', ID),
    ).resolves.toBeNull();
  });

  it('không tồn tại ⇒ null', async () => {
    const { directory, prisma } = setup();
    prisma.product.findUnique.mockResolvedValue(null);

    await expect(
      directory.resolve(REPORTER, 'PRODUCT', ID),
    ).resolves.toBeNull();
  });
});

describe('mọi loại', () => {
  it('mỗi loại đối tượng của hợp đồng đều được cổng xử lý (không loại nào rơi vào nhánh mặc định)', async () => {
    const { directory, prisma } = setup();
    prisma.review.findUnique.mockResolvedValue(null);
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.shop.findUnique.mockResolvedValue(null);
    prisma.product.findUnique.mockResolvedValue(null);

    for (const targetType of REPORT_TARGET_TYPES) {
      await expect(
        directory.resolve(REPORTER, targetType, ID),
      ).resolves.toBeNull();
    }
  });

  it('ảnh chụp của mọi loại qua parseReportSnapshot (strict + trần byte) mà không lỗi', async () => {
    const { directory, prisma } = setup();
    prisma.review.findUnique.mockResolvedValue(reviewRow());
    prisma.conversation.findUnique.mockResolvedValue(conversationRow());
    prisma.shop.findUnique.mockResolvedValue({
      ownerId: OWNER,
      status: 'APPROVED',
      name: 'Shop A',
      slug: 'shop-a',
    });
    prisma.product.findUnique.mockResolvedValue(productRow());

    for (const targetType of REPORT_TARGET_TYPES) {
      const result = await directory.resolve(REPORTER, targetType, ID);
      expect(result).not.toBeNull();
      expect(() =>
        parseReportSnapshot(targetType, result?.snapshot),
      ).not.toThrow();
    }
  });
});
