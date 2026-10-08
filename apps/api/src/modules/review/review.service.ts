import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateReviewInput,
  ListReviewsQuery,
  ProductReviewsResponse,
  Review,
  SellerReview,
  SellerReviewListQuery,
  SellerReviewListResponse,
  UpdateReviewInput,
} from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  getReviewBlockReason,
  readReviewWindowDays,
  type ReviewBlockReason,
} from '../../shared/review/review-eligibility';
import {
  ProductRatingService,
  summarizeRatings,
  toDistribution,
} from '../product/product-rating.service';
import { maskReviewerName } from './review-name';

// Chỉ select đúng các cột lộ ra response — KHÔNG userId/email; tên người đánh giá được che ở toReview.
const reviewSelect = {
  id: true,
  rating: true,
  comment: true,
  createdAt: true,
  editedAt: true,
  sellerReply: true,
  sellerRepliedAt: true,
  user: { select: { name: true } },
} satisfies Prisma.ReviewSelect;

const sellerReviewSelect = {
  ...reviewSelect,
  product: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ReviewSelect;

type ReviewRow = Prisma.ReviewGetPayload<{ select: typeof reviewSelect }>;
type SellerReviewRow = Prisma.ReviewGetPayload<{
  select: typeof sellerReviewSelect;
}>;

// Map tường minh từng field (không spread `...row`): response chỉ có đúng những gì khai ở đây, nên select có
// thêm cột nội bộ sau này cũng không tự lộ ra ngoài (rules/backend.md mục 4).
const toReview = (row: ReviewRow): Review => ({
  id: row.id,
  rating: row.rating,
  comment: row.comment,
  createdAt: row.createdAt.toISOString(),
  editedAt: row.editedAt?.toISOString() ?? null,
  reviewerName: maskReviewerName(row.user.name),
  sellerReply: row.sellerReply,
  sellerRepliedAt: row.sellerRepliedAt?.toISOString() ?? null,
});

const toSellerReview = (row: SellerReviewRow): SellerReview => ({
  ...toReview(row),
  product: {
    id: row.product.id,
    name: row.product.name,
    slug: row.product.slug,
  },
});

const orderNotFound = () =>
  new AppException(404, 'ORDER_NOT_FOUND', 'Order not found');

const reviewNotFound = () =>
  new AppException(404, 'REVIEW_NOT_FOUND', 'Review not found');

const reviewNotAllowed = (reason: ReviewBlockReason) =>
  new AppException(
    409,
    'REVIEW_NOT_ALLOWED',
    `Review is not allowed: ${reason}`,
    { reason },
  );

const reviewEditNotAllowed = () =>
  new AppException(
    409,
    'REVIEW_EDIT_NOT_ALLOWED',
    'A review can only be edited once',
  );

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

// Đánh giá sản phẩm (Week9.md 1.8, 2.10). Dữ liệu đơn hàng nó tự đọc bằng PrismaService (module `review` không
// được import `order`, module-boundaries.spec.ts); điểm trung bình denormalized trên Product chỉ được ghi qua
// ProductRatingService — mọi thay đổi review (tạo/sửa) đi qua `updateRating` để khoá dòng product TRƯỚC khi chèn/
// sửa, nếu không hai review đồng thời trên cùng sản phẩm sẽ deadlock.
@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productRating: ProductRatingService,
  ) {}

  // --- Người mua ------------------------------------------------------------------------------

  // Viết đánh giá cho MỘT sản phẩm trong MỘT đơn của chính mình. Luật "được/không được" nằm ở
  // getReviewBlockReason (shared/review) — cùng hàm tính cờ `canReview` ở chi tiết đơn, nên nút hiện ra thì bấm
  // được. Đơn của người khác / không tồn tại cùng 404 (không lộ id nào có thật, cùng getForBuyer).
  async create(userId: string, input: CreateReviewInput): Promise<Review> {
    const order = await this.prisma.order.findFirst({
      where: { id: input.orderId, userId },
      select: {
        status: true,
        // Thời điểm COMPLETED đọc từ lịch sử (không có cột completedAt) — cùng cách cửa sổ trả hàng.
        statusHistory: {
          where: { toStatus: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
        // OrderItem không có productId: nối qua variant → sản phẩm.
        items: { select: { productVariant: { select: { productId: true } } } },
        reviews: { where: { userId }, select: { productId: true } },
      },
    });
    if (!order) throw orderNotFound();

    const reason = getReviewBlockReason({
      containsProduct: order.items.some(
        (item) => item.productVariant.productId === input.productId,
      ),
      orderStatus: order.status,
      completedAt: order.statusHistory[0]?.createdAt ?? null,
      now: new Date(),
      windowDays: readReviewWindowDays(),
      alreadyReviewed: order.reviews.some(
        (review) => review.productId === input.productId,
      ),
    });
    if (reason) throw reviewNotAllowed(reason);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await this.productRating.updateRating(
          tx,
          input.productId,
          () =>
            tx.review.create({
              data: {
                userId,
                productId: input.productId,
                orderId: input.orderId,
                rating: input.rating,
                comment: input.comment ?? null,
              },
              select: reviewSelect,
            }),
        );
        return toReview(created);
      });
    } catch (error) {
      // Unique [userId, productId, orderId] là trọng tài cuối khi hai lần gửi lọt qua bước kiểm ở trên cùng
      // lúc (bấm đúp). Lỗi P2002 làm hỏng cả transaction nên bắt ở NGOÀI $transaction (rollback cũng nhả khoá).
      if (isUniqueViolation(error)) throw reviewNotAllowed('ALREADY_REVIEWED');
      throw error;
    }
  }

  // Sửa đánh giá của chính mình — ĐÚNG MỘT LẦN (không tự xoá). Đánh giá của người khác / không tồn tại cùng
  // 404. UPDATE có điều kiện `edited_at IS NULL` là ổ khoá idempotent: hai lần sửa đồng thời thì đúng một bên
  // thắng, bên kia nhận 409 và giao dịch của nó rollback.
  async update(
    userId: string,
    reviewId: string,
    input: UpdateReviewInput,
  ): Promise<Review> {
    const existing = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { userId: true, productId: true, editedAt: true },
    });
    if (!existing || existing.userId !== userId) throw reviewNotFound();
    if (existing.editedAt) throw reviewEditNotAllowed();

    await this.prisma.$transaction((tx) =>
      this.productRating.updateRating(tx, existing.productId, async () => {
        const { count } = await tx.review.updateMany({
          where: { id: reviewId, userId, editedAt: null },
          data: {
            rating: input.rating,
            // Form gửi lại ĐỦ rating + comment: bỏ trống comment = xoá nội dung cũ.
            comment: input.comment ?? null,
            editedAt: new Date(),
          },
        });
        if (count === 0) throw reviewEditNotAllowed();
      }),
    );

    const updated = await this.prisma.review.findUniqueOrThrow({
      where: { id: reviewId },
      select: reviewSelect,
    });
    return toReview(updated);
  }

  // --- Đọc công khai --------------------------------------------------------------------------

  // Chỉ khi sản phẩm PUBLISHED **và** shop APPROVED (rules/backend.md mục 6) — nháp / đã lưu trữ / shop chưa
  // duyệt hoặc bị khoá đều 404 y hệt "không tồn tại", kể cả với chủ shop (route này công khai, không biết
  // viewer). Phần tóm tắt TÍNH TỪ CHÍNH phân bố sao vừa đọc (cùng công thức với cột denormalized của Product)
  // nên con số, phân bố và danh sách luôn khớp nhau; `total` của danh sách lọc theo sao lấy từ phân bố, không
  // cần thêm một truy vấn đếm.
  async listForProduct(
    idOrSlug: string,
    query: ListReviewsQuery,
  ): Promise<ProductReviewsResponse> {
    const product = await this.prisma.product.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        status: 'PUBLISHED',
        shop: { status: 'APPROVED' },
      },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const [groups, rows] = await Promise.all([
      this.prisma.review.groupBy({
        by: ['rating'],
        where: { productId: product.id },
        _count: { _all: true },
      }),
      this.prisma.review.findMany({
        where: {
          productId: product.id,
          ...(query.rating ? { rating: query.rating } : {}),
        },
        // `id` làm tie-break để phân trang ổn định khi nhiều đánh giá cùng mili-giây.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: reviewSelect,
      }),
    ]);

    const distribution = toDistribution(groups);
    const summary = summarizeRatings(distribution);
    return {
      summary: { ...summary, distribution },
      items: rows.map(toReview),
      total: query.rating
        ? distribution[String(query.rating) as keyof typeof distribution]
        : summary.reviewCount,
      page: query.page,
      limit: query.limit,
    };
  }

  // --- Seller ---------------------------------------------------------------------------------

  // shopId đã được ShopOwnerGuard xác nhận là của người gọi. Đánh giá của MỌI sản phẩm của shop (kể cả đã lưu
  // trữ), không phụ thuộc trạng thái shop. Tên người đánh giá vẫn bị che.
  async listForShop(
    shopId: string,
    query: SellerReviewListQuery,
  ): Promise<SellerReviewListResponse> {
    const where: Prisma.ReviewWhereInput = {
      product: { shopId },
      ...(query.rating ? { rating: query.rating } : {}),
      // 'true' = đã trả lời (sellerReply khác null), 'false' = chưa trả lời; bỏ trống = cả hai.
      ...(query.replied === undefined
        ? {}
        : { sellerReply: query.replied === 'true' ? { not: null } : null }),
    };

    const [total, rows] = await Promise.all([
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: sellerReviewSelect,
      }),
    ]);

    return {
      items: rows.map(toSellerReview),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  // Trả lời MỘT đánh giá của sản phẩm thuộc shop mình; trả lời lại = sửa (ghi đè, cập nhật mốc), không xoá được.
  // Đánh giá của shop khác / không tồn tại cùng 404. Shop đang bị khoá tạm vẫn trả lời được (vẫn xử lý đơn).
  // Không động tới rating nên không cần khoá product / tính lại điểm.
  async reply(
    shopId: string,
    reviewId: string,
    reply: string,
  ): Promise<SellerReview> {
    const { count } = await this.prisma.review.updateMany({
      where: { id: reviewId, product: { shopId } },
      data: { sellerReply: reply, sellerRepliedAt: new Date() },
    });
    if (count === 0) throw reviewNotFound();

    const updated = await this.prisma.review.findFirstOrThrow({
      where: { id: reviewId, product: { shopId } },
      select: sellerReviewSelect,
    });
    return toSellerReview(updated);
  }
}
