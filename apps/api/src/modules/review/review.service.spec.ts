import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  productReviewsResponseSchema,
  sellerReviewListResponseSchema,
  reviewSchema,
} from '@ecommerce/types';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import type { ProductRatingService } from '../product/product-rating.service';
import { ReviewService } from './review.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

// Đơn như ReviewService.create đọc về: COMPLETED hôm qua, chứa sản phẩm p1, chưa đánh giá gì.
function loadedOrder(overrides: Record<string, unknown> = {}) {
  return {
    status: 'COMPLETED',
    statusHistory: [{ createdAt: daysAgo(1) }],
    items: [
      { productVariant: { productId: 'p1' } },
      { productVariant: { productId: 'p2' } },
    ],
    reviews: [],
    ...overrides,
  };
}

// Dòng review như DB trả về (kèm user.name để che) — cố ý có cả userId/email để chứng minh không lọt ra response.
function reviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rv-1',
    rating: 5,
    comment: 'Rất tốt',
    createdAt: new Date('2026-10-08T10:00:00.000Z'),
    editedAt: null,
    sellerReply: null,
    sellerRepliedAt: null,
    user: { name: 'Nguyễn Văn A' },
    userId: 'user-secret',
    email: 'secret@example.com',
    ...overrides,
  };
}

describe('ReviewService', () => {
  let service: ReviewService;
  // Thứ tự gọi để kiểm "khoá product TRƯỚC khi chèn/sửa review, tính lại SAU".
  let calls: string[];

  let tx: {
    review: { create: jest.Mock; updateMany: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    order: { findFirst: jest.Mock };
    product: { findFirst: jest.Mock };
    review: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findFirstOrThrow: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let productRating: { updateRating: jest.Mock };

  beforeEach(() => {
    delete process.env.REVIEW_WINDOW_DAYS;
    calls = [];
    tx = {
      review: {
        create: jest.fn().mockImplementation(() => {
          calls.push('insert');
          return Promise.resolve(reviewRow());
        }),
        updateMany: jest.fn().mockImplementation(() => {
          calls.push('update');
          return Promise.resolve({ count: 1 });
        }),
      },
    };
    prisma = {
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      order: { findFirst: jest.fn().mockResolvedValue(loadedOrder()) },
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'p1' }) },
      review: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue(reviewRow()),
        findFirstOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    productRating = {
      updateRating: jest
        .fn()
        .mockImplementation(
          async (_tx: unknown, _productId: string, change: () => unknown) => {
            calls.push('lock');
            const result = await change();
            calls.push('recompute');
            return result;
          },
        ),
    };
    service = new ReviewService(
      prisma as unknown as PrismaService,
      productRating as unknown as ProductRatingService,
    );
  });

  afterEach(() => {
    delete process.env.REVIEW_WINDOW_DAYS;
  });

  // --- create -------------------------------------------------------------------------------------

  describe('create', () => {
    const input = { orderId: 'o1', productId: 'p1', rating: 5 };

    it('đọc đơn theo CẢ id lẫn userId (không tin orderId suông); đơn của người khác / không tồn tại ⇒ 404 ORDER_NOT_FOUND, không ghi gì', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expectAppException(service.create('user-1', input), {
        status: 404,
        code: 'ORDER_NOT_FOUND',
      });
      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'o1', userId: 'user-1' } }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    describe('ma trận điều kiện (BE là nơi quyết định, FE chỉ đọc cờ canReview)', () => {
      it('sản phẩm không có trong đơn ⇒ 409 NOT_PURCHASED', async () => {
        await expectAppException(
          service.create('user-1', { ...input, productId: 'p-khac' }),
          {
            status: 409,
            code: 'REVIEW_NOT_ALLOWED',
            details: { reason: 'NOT_PURCHASED' },
          },
        );
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it.each([
        'AWAITING_PAYMENT',
        'PENDING',
        'CONFIRMED',
        'PACKED',
        'SHIPPING',
        'CANCELLED',
        'REFUNDED',
      ])('đơn %s ⇒ 409 ORDER_NOT_COMPLETED', async (status) => {
        prisma.order.findFirst.mockResolvedValue(loadedOrder({ status }));

        await expectAppException(service.create('user-1', input), {
          status: 409,
          code: 'REVIEW_NOT_ALLOWED',
          details: { reason: 'ORDER_NOT_COMPLETED' },
        });
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('quá 90 ngày kể từ lúc COMPLETED ⇒ 409 WINDOW_EXPIRED; còn trong cửa sổ thì được', async () => {
        prisma.order.findFirst.mockResolvedValueOnce(
          loadedOrder({ statusHistory: [{ createdAt: daysAgo(91) }] }),
        );
        await expectAppException(service.create('user-1', input), {
          status: 409,
          code: 'REVIEW_NOT_ALLOWED',
          details: { reason: 'WINDOW_EXPIRED' },
        });

        prisma.order.findFirst.mockResolvedValueOnce(
          loadedOrder({ statusHistory: [{ createdAt: daysAgo(89) }] }),
        );
        await expect(service.create('user-1', input)).resolves.toBeDefined();
      });

      it('REVIEW_WINDOW_DAYS đọc LÚC DÙNG', async () => {
        prisma.order.findFirst.mockResolvedValue(
          loadedOrder({ statusHistory: [{ createdAt: daysAgo(10) }] }),
        );
        process.env.REVIEW_WINDOW_DAYS = '7';

        await expectAppException(service.create('user-1', input), {
          status: 409,
          code: 'REVIEW_NOT_ALLOWED',
          details: { reason: 'WINDOW_EXPIRED' },
        });

        process.env.REVIEW_WINDOW_DAYS = '30';
        await expect(service.create('user-1', input)).resolves.toBeDefined();
      });

      it('COMPLETED nhưng không còn dấu vết lúc hoàn tất ⇒ 409 WINDOW_EXPIRED (từ chối an toàn)', async () => {
        prisma.order.findFirst.mockResolvedValue(
          loadedOrder({ statusHistory: [] }),
        );

        await expectAppException(service.create('user-1', input), {
          status: 409,
          code: 'REVIEW_NOT_ALLOWED',
          details: { reason: 'WINDOW_EXPIRED' },
        });
      });

      it('đã đánh giá sản phẩm này trong đơn này ⇒ 409 ALREADY_REVIEWED; đánh giá sản phẩm KHÁC của đơn không chặn', async () => {
        prisma.order.findFirst.mockResolvedValueOnce(
          loadedOrder({ reviews: [{ productId: 'p1' }] }),
        );
        await expectAppException(service.create('user-1', input), {
          status: 409,
          code: 'REVIEW_NOT_ALLOWED',
          details: { reason: 'ALREADY_REVIEWED' },
        });

        prisma.order.findFirst.mockResolvedValueOnce(
          loadedOrder({ reviews: [{ productId: 'p2' }] }),
        );
        await expect(service.create('user-1', input)).resolves.toBeDefined();
      });

      it('chỉ đọc đánh giá của CHÍNH người mua và đúng các cột cần (id/status/lịch sử COMPLETED/variant → sản phẩm)', async () => {
        await service.create('user-1', input);

        expect(prisma.order.findFirst).toHaveBeenCalledWith({
          where: { id: 'o1', userId: 'user-1' },
          select: {
            status: true,
            statusHistory: {
              where: { toStatus: 'COMPLETED' },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { createdAt: true },
            },
            items: {
              select: { productVariant: { select: { productId: true } } },
            },
            reviews: {
              where: { userId: 'user-1' },
              select: { productId: true },
            },
          },
        });
      });
    });

    describe('ghi', () => {
      it('khoá product TRƯỚC khi chèn review, tính lại SAU — cả ba trong MỘT transaction', async () => {
        await service.create('user-1', input);

        expect(calls).toEqual(['lock', 'insert', 'recompute']);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(productRating.updateRating).toHaveBeenCalledWith(
          tx,
          'p1',
          expect.any(Function),
        );
      });

      it('chèn đúng userId (từ token), productId, orderId, rating; nhận xét bỏ trống ⇒ null', async () => {
        await service.create('user-1', input);

        expect(tx.review.create).toHaveBeenCalledWith({
          data: {
            userId: 'user-1',
            productId: 'p1',
            orderId: 'o1',
            rating: 5,
            comment: null,
          },
          select: expect.any(Object) as object,
        });
      });

      it('giữ nhận xét khi có', async () => {
        await service.create('user-1', { ...input, comment: 'Rất tốt' });

        const [args] = tx.review.create.mock.calls[0] as [
          { data: { comment: string } },
        ];
        expect(args.data.comment).toBe('Rất tốt');
      });

      it('trả đánh giá vừa tạo: tên bị che, KHÔNG lộ userId / email, ngày dạng ISO; parse được bằng schema dùng chung', async () => {
        const result = await service.create('user-1', input);

        expect(() => reviewSchema.parse(result)).not.toThrow();
        expect(result).toEqual({
          id: 'rv-1',
          rating: 5,
          comment: 'Rất tốt',
          createdAt: '2026-10-08T10:00:00.000Z',
          editedAt: null,
          reviewerName: 'N***',
          sellerReply: null,
          sellerRepliedAt: null,
        });
        expect(JSON.stringify(result)).not.toMatch(/secret|Nguyễn Văn A/);
      });

      it('unique [userId, productId, orderId] vi phạm (bấm đúp lọt qua bước kiểm) ⇒ 409 ALREADY_REVIEWED', async () => {
        tx.review.create.mockRejectedValue(uniqueViolation());

        await expectAppException(service.create('user-1', input), {
          status: 409,
          code: 'REVIEW_NOT_ALLOWED',
          details: { reason: 'ALREADY_REVIEWED' },
        });
      });

      it('lỗi khác (DB...) được giữ nguyên, không bị hiểu nhầm thành ALREADY_REVIEWED', async () => {
        tx.review.create.mockRejectedValue(new Error('db down'));

        await expect(service.create('user-1', input)).rejects.toThrow(
          'db down',
        );
      });
    });
  });

  // --- update -------------------------------------------------------------------------------------

  describe('update', () => {
    const input = { rating: 4, comment: 'Dùng một tuần vẫn tốt' };
    const existing = { userId: 'user-1', productId: 'p1', editedAt: null };

    beforeEach(() => {
      prisma.review.findUnique.mockResolvedValue(existing);
    });

    it('đánh giá không tồn tại / của người khác ⇒ 404 REVIEW_NOT_FOUND (không phân biệt), không mở transaction', async () => {
      prisma.review.findUnique.mockResolvedValueOnce(null);
      await expectAppException(service.update('user-1', 'rv-x', input), {
        status: 404,
        code: 'REVIEW_NOT_FOUND',
      });

      prisma.review.findUnique.mockResolvedValueOnce({
        ...existing,
        userId: 'user-khac',
      });
      await expectAppException(service.update('user-1', 'rv-1', input), {
        status: 404,
        code: 'REVIEW_NOT_FOUND',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('đã sửa một lần (editedAt có giá trị) ⇒ 409 REVIEW_EDIT_NOT_ALLOWED, không mở transaction', async () => {
      prisma.review.findUnique.mockResolvedValue({
        ...existing,
        editedAt: new Date(),
      });

      await expectAppException(service.update('user-1', 'rv-1', input), {
        status: 409,
        code: 'REVIEW_EDIT_NOT_ALLOWED',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('khoá product của đánh giá TRƯỚC khi sửa, tính lại SAU, trong một transaction', async () => {
      await service.update('user-1', 'rv-1', input);

      expect(calls).toEqual(['lock', 'update', 'recompute']);
      expect(productRating.updateRating).toHaveBeenCalledWith(
        tx,
        'p1',
        expect.any(Function),
      );
    });

    it('UPDATE có điều kiện id + userId + editedAt IS NULL (ổ khoá idempotent), ghi rating / nhận xét / editedAt', async () => {
      await service.update('user-1', 'rv-1', input);

      const [args] = tx.review.updateMany.mock.calls[0] as [
        {
          where: unknown;
          data: { rating: number; comment: string | null; editedAt: Date };
        },
      ];
      expect(args.where).toEqual({
        id: 'rv-1',
        userId: 'user-1',
        editedAt: null,
      });
      expect(args.data.rating).toBe(4);
      expect(args.data.comment).toBe('Dùng một tuần vẫn tốt');
      expect(args.data.editedAt).toBeInstanceOf(Date);
    });

    it('bỏ trống nhận xét khi sửa = xoá nội dung cũ (form gửi lại ĐỦ rating + nhận xét)', async () => {
      await service.update('user-1', 'rv-1', { rating: 3 });

      const [args] = tx.review.updateMany.mock.calls[0] as [
        { data: { comment: string | null } },
      ];
      expect(args.data.comment).toBeNull();
    });

    it('thua race (hai lần sửa đồng thời, bên kia đã đặt editedAt) ⇒ 409 REVIEW_EDIT_NOT_ALLOWED, giao dịch rollback (không tính lại)', async () => {
      tx.review.updateMany.mockResolvedValue({ count: 0 });

      await expectAppException(service.update('user-1', 'rv-1', input), {
        status: 409,
        code: 'REVIEW_EDIT_NOT_ALLOWED',
      });
      expect(calls).not.toContain('recompute');
    });

    it('trả đánh giá sau khi sửa (đọc lại sau commit), tên bị che', async () => {
      prisma.review.findUniqueOrThrow.mockResolvedValue(
        reviewRow({
          rating: 4,
          editedAt: new Date('2026-10-09T10:00:00.000Z'),
        }),
      );

      const result = await service.update('user-1', 'rv-1', input);

      expect(result).toMatchObject({
        rating: 4,
        editedAt: '2026-10-09T10:00:00.000Z',
        reviewerName: 'N***',
      });
      expect(JSON.stringify(result)).not.toMatch(/secret/);
    });
  });

  // --- listForProduct -----------------------------------------------------------------------------

  describe('listForProduct', () => {
    const query = { page: 1, limit: 10 };
    const groups = [
      { rating: 5, _count: { _all: 2 } },
      { rating: 4, _count: { _all: 1 } },
    ];

    it('chỉ sản phẩm PUBLISHED của shop APPROVED, tìm theo id HOẶC slug', async () => {
      await service.listForProduct('ao-thun', query);

      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ id: 'ao-thun' }, { slug: 'ao-thun' }],
          status: 'PUBLISHED',
          shop: { status: 'APPROVED' },
        },
        select: { id: true },
      });
    });

    it('sản phẩm không công khai (nháp / lưu trữ / shop chưa duyệt / không tồn tại) ⇒ 404, không đọc review', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.listForProduct('khong-co', query),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.review.groupBy).not.toHaveBeenCalled();
      expect(prisma.review.findMany).not.toHaveBeenCalled();
    });

    it('tóm tắt TÍNH TỪ phân bố sao: điểm trung bình làm tròn 2 chữ số, số đánh giá, đủ 5 khoá phân bố (mức trống là 0)', async () => {
      prisma.review.groupBy.mockResolvedValue(groups);

      const result = await service.listForProduct('p1', query);

      // (5+5+4)/3 = 4.666… ⇒ 4.67
      expect(result.summary).toEqual({
        avgRating: 4.67,
        reviewCount: 3,
        distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 2 },
      });
      expect(result.total).toBe(3);
    });

    it('chưa có đánh giá nào ⇒ 0 / 0, phân bố toàn 0, danh sách rỗng', async () => {
      const result = await service.listForProduct('p1', query);

      expect(result).toEqual({
        summary: {
          avgRating: 0,
          reviewCount: 0,
          distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
        },
        items: [],
        total: 0,
        page: 1,
        limit: 10,
      });
    });

    it('lọc theo sao: danh sách + total thu hẹp theo sao đó, còn tóm tắt vẫn là của TOÀN BỘ đánh giá', async () => {
      prisma.review.groupBy.mockResolvedValue(groups);

      const result = await service.listForProduct('p1', {
        ...query,
        rating: 4,
      });

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { productId: 'p1', rating: 4 } }),
      );
      expect(result.total).toBe(1);
      expect(result.summary.reviewCount).toBe(3);
    });

    it('lọc sao không ai chọn ⇒ total 0', async () => {
      prisma.review.groupBy.mockResolvedValue(groups);

      const result = await service.listForProduct('p1', {
        ...query,
        rating: 1,
      });

      expect(result.total).toBe(0);
    });

    it('mới nhất trước, `id` làm tie-break (phân trang ổn định), skip/take theo page/limit', async () => {
      await service.listForProduct('p1', { page: 3, limit: 5 });

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 10,
          take: 5,
        }),
      );
    });

    it('groupBy chỉ theo sản phẩm này (không lọc sao — phân bố là của toàn bộ)', async () => {
      await service.listForProduct('p1', { ...query, rating: 5 });

      expect(prisma.review.groupBy).toHaveBeenCalledWith({
        by: ['rating'],
        where: { productId: 'p1' },
        _count: { _all: true },
      });
    });

    it('response công khai: tên bị che, KHÔNG userId / email / tên đầy đủ; parse được bằng schema dùng chung', async () => {
      prisma.review.groupBy.mockResolvedValue(groups);
      prisma.review.findMany.mockResolvedValue([
        reviewRow(),
        reviewRow({
          id: 'rv-2',
          rating: 4,
          user: { name: 'Trần Thị B' },
          sellerReply: 'Cảm ơn bạn',
          sellerRepliedAt: new Date('2026-10-09T08:00:00.000Z'),
        }),
      ]);

      const result = await service.listForProduct('p1', query);

      expect(() => productReviewsResponseSchema.parse(result)).not.toThrow();
      expect(result.items.map((item) => item.reviewerName)).toEqual([
        'N***',
        'T***',
      ]);
      expect(result.items[1]).toMatchObject({
        sellerReply: 'Cảm ơn bạn',
        sellerRepliedAt: '2026-10-09T08:00:00.000Z',
      });
      expect(JSON.stringify(result)).not.toMatch(
        /secret|Nguyễn Văn A|Trần Thị B/,
      );
    });
  });

  // --- listForShop --------------------------------------------------------------------------------

  describe('listForShop', () => {
    const query = { page: 1, limit: 10 };
    const sellerRow = (overrides: Record<string, unknown> = {}) =>
      reviewRow({
        product: { id: 'p1', name: 'Áo thun', slug: 'ao-thun' },
        ...overrides,
      });

    it('luôn giới hạn theo sản phẩm của shop mình (shopId do ShopOwnerGuard xác nhận), mới nhất trước', async () => {
      await service.listForShop('shop-1', query);

      expect(prisma.review.count).toHaveBeenCalledWith({
        where: { product: { shopId: 'shop-1' } },
      });
      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { product: { shopId: 'shop-1' } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 0,
          take: 10,
        }),
      );
    });

    it("replied='true' ⇒ đã trả lời (sellerReply khác null); replied='false' ⇒ chưa trả lời (sellerReply null)", async () => {
      await service.listForShop('shop-1', { ...query, replied: 'true' });
      await service.listForShop('shop-1', { ...query, replied: 'false' });

      expect(prisma.review.count).toHaveBeenNthCalledWith(1, {
        where: { product: { shopId: 'shop-1' }, sellerReply: { not: null } },
      });
      expect(prisma.review.count).toHaveBeenNthCalledWith(2, {
        where: { product: { shopId: 'shop-1' }, sellerReply: null },
      });
    });

    it('lọc sao thu hẹp thêm, kết hợp được với replied', async () => {
      await service.listForShop('shop-1', {
        ...query,
        replied: 'false',
        rating: 2,
      });

      expect(prisma.review.count).toHaveBeenCalledWith({
        where: {
          product: { shopId: 'shop-1' },
          rating: 2,
          sellerReply: null,
        },
      });
    });

    it('trả kèm sản phẩm được đánh giá; tên người mua vẫn bị che, KHÔNG userId / email; parse được bằng schema dùng chung', async () => {
      prisma.review.count.mockResolvedValue(1);
      prisma.review.findMany.mockResolvedValue([sellerRow()]);

      const result = await service.listForShop('shop-1', query);

      expect(() => sellerReviewListResponseSchema.parse(result)).not.toThrow();
      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        id: 'rv-1',
        reviewerName: 'N***',
        product: { id: 'p1', name: 'Áo thun', slug: 'ao-thun' },
      });
      expect(JSON.stringify(result)).not.toMatch(/secret|Nguyễn Văn A/);
    });
  });

  // --- reply --------------------------------------------------------------------------------------

  describe('reply', () => {
    beforeEach(() => {
      prisma.review.findFirstOrThrow.mockResolvedValue(
        reviewRow({
          product: { id: 'p1', name: 'Áo thun', slug: 'ao-thun' },
          sellerReply: 'Cảm ơn bạn',
          sellerRepliedAt: new Date('2026-10-09T08:00:00.000Z'),
        }),
      );
    });

    it('UPDATE giới hạn theo đánh giá thuộc sản phẩm của shop mình, ghi câu trả lời + mốc', async () => {
      await service.reply('shop-1', 'rv-1', 'Cảm ơn bạn');

      const [args] = prisma.review.updateMany.mock.calls[0] as [
        {
          where: unknown;
          data: { sellerReply: string; sellerRepliedAt: Date };
        },
      ];
      expect(args.where).toEqual({
        id: 'rv-1',
        product: { shopId: 'shop-1' },
      });
      expect(args.data.sellerReply).toBe('Cảm ơn bạn');
      expect(args.data.sellerRepliedAt).toBeInstanceOf(Date);
    });

    it('đánh giá thuộc shop khác / không tồn tại ⇒ 404 REVIEW_NOT_FOUND (không phân biệt)', async () => {
      prisma.review.updateMany.mockResolvedValue({ count: 0 });

      await expectAppException(service.reply('shop-1', 'rv-x', 'x'), {
        status: 404,
        code: 'REVIEW_NOT_FOUND',
      });
      expect(prisma.review.findFirstOrThrow).not.toHaveBeenCalled();
    });

    it('không động tới điểm đánh giá: không mở transaction, không khoá / tính lại product', async () => {
      await service.reply('shop-1', 'rv-1', 'Cảm ơn bạn');

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(productRating.updateRating).not.toHaveBeenCalled();
    });

    it('trả đánh giá kèm sản phẩm (đọc lại theo shop) với câu trả lời mới', async () => {
      const result = await service.reply('shop-1', 'rv-1', 'Cảm ơn bạn');

      expect(prisma.review.findFirstOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rv-1', product: { shopId: 'shop-1' } },
        }),
      );
      expect(result).toMatchObject({
        sellerReply: 'Cảm ơn bạn',
        sellerRepliedAt: '2026-10-09T08:00:00.000Z',
        product: { slug: 'ao-thun' },
      });
    });
  });
});
