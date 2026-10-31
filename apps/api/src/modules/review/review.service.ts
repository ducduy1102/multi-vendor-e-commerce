import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateReviewInput,
  ListReviewsQuery,
  ProductReviewsResponse,
  Review,
  ReviewModerationResponse,
  SellerReview,
  SellerReviewListQuery,
  SellerReviewListResponse,
  UpdateReviewInput,
} from '@ecommerce/types';
import { AdminAuditService } from '../../shared/audit/admin-audit.service';
import type { AuditRequestContext } from '../../shared/audit/audit-request-context';
import { AppException } from '../../shared/exceptions/app.exception';
import { NotificationService } from '../../shared/notification/notification.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { TxClient } from '../../shared/prisma/tx-client';
import { redactWriteError } from '../../shared/utils/redact-write-error';
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
  hiddenAt: true,
  hiddenReason: true,
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

// Đánh giá đã ẩn thành dòng trạng thái: giữ sao / ngày / tên che để shop nhận ra đánh giá nào, kèm lý do của Admin, nhưng KHÔNG trả lại
// nội dung (đã ẩn vì vi phạm — vd lộ thông tin cá nhân — thì không đưa lại cho ai ngoài tác giả).
const toSellerReview = (row: SellerReviewRow): SellerReview => {
  const isHidden = row.hiddenAt !== null;
  return {
    ...toReview(row),
    comment: isHidden ? null : row.comment,
    isHidden,
    hiddenReason: isHidden ? row.hiddenReason : null,
    product: {
      id: row.product.id,
      name: row.product.name,
      slug: row.product.slug,
    },
  };
};

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

// Đánh giá đã bị Admin ẩn (Week11.md 5.5): tác giả không sửa được.
const reviewHidden = () =>
  new AppException(409, 'REVIEW_HIDDEN', 'This review has been hidden');

const reviewAlreadyHidden = () =>
  new AppException(
    409,
    'REVIEW_ALREADY_HIDDEN',
    'This review is already hidden',
  );

const reviewNotHidden = () =>
  new AppException(409, 'REVIEW_NOT_HIDDEN', 'This review is not hidden');

// Ẩn / hiện đánh giá do MỘT Admin thực hiện lên MỘT đánh giá. `reason` là văn bản Admin nhập (đã qua schema dùng chung).
export interface ReviewModerationInput {
  adminId: string;
  reviewId: string;
  reason: string;
  context?: AuditRequestContext;
}

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
    private readonly notificationService: NotificationService,
    private readonly auditService: AdminAuditService,
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
        // Chủ shop không được đánh giá hàng của chính shop mình (đơn tự mua có từ trước khi chặn mua).
        shop: { select: { ownerId: true } },
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
      isOwnShop: order.shop.ownerId === userId,
      orderStatus: order.status,
      completedAt: order.statusHistory[0]?.createdAt ?? null,
      now: new Date(),
      windowDays: readReviewWindowDays(),
      alreadyReviewed: order.reviews.some(
        (review) => review.productId === input.productId,
      ),
    });
    if (reason) throw reviewNotAllowed(reason);

    let review: Review;
    try {
      review = await this.prisma.$transaction(async (tx) => {
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
    // Báo chủ shop có đánh giá mới, SAU commit (không bao giờ ném).
    await this.notificationService.notify({
      kind: 'REVIEW_CREATED',
      reviewId: review.id,
    });
    return review;
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
      select: {
        userId: true,
        productId: true,
        editedAt: true,
        hiddenAt: true,
      },
    });
    if (!existing || existing.userId !== userId) throw reviewNotFound();
    // Đánh giá đã bị Admin ẩn thì không sửa được (D6) — kiểm TRƯỚC "đã sửa một lần" vì đó là lý do đúng hơn để báo cho tác giả.
    if (existing.hiddenAt) throw reviewHidden();
    if (existing.editedAt) throw reviewEditNotAllowed();

    await this.prisma.$transaction((tx) =>
      this.productRating.updateRating(tx, existing.productId, async () => {
        const { count } = await tx.review.updateMany({
          where: { id: reviewId, userId, editedAt: null, hiddenAt: null },
          data: {
            rating: input.rating,
            // Form gửi lại ĐỦ rating + comment: bỏ trống comment = xoá nội dung cũ.
            comment: input.comment ?? null,
            editedAt: new Date(),
          },
        });
        if (count === 0) {
          // Không khớp hàng nào: hoặc đã sửa một lần, hoặc Admin vừa ẩn nó (Admin ẩn cũng khoá dòng product trước nên đọc lại ở đây
          // thấy kết quả đã commit của họ).
          const current = await tx.review.findUnique({
            where: { id: reviewId },
            select: { hiddenAt: true },
          });
          throw current?.hiddenAt ? reviewHidden() : reviewEditNotAllowed();
        }
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
        // Chỉ đánh giá hiển thị (chưa bị Admin ẩn) — cùng điều kiện với cột denormalized của Product.
        where: { productId: product.id, hiddenAt: null },
        _count: { _all: true },
      }),
      this.prisma.review.findMany({
        where: {
          productId: product.id,
          hiddenAt: null,
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
      // Đánh giá bị Admin ẩn VẪN nằm trong danh sách (dòng trạng thái, Week11.md 5.5) trừ tab "Chưa trả lời": đó là hàng việc cần làm,
      // mà đánh giá đã ẩn không trả lời được nên không xếp vào đó.
      ...(query.replied === 'false' ? { hiddenAt: null } : {}),
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
    // Thử đặt lời trả lời LẦN ĐẦU trước (`sellerRepliedAt IS NULL`): chỉ lần đầu mới báo người mua — sửa lại lời trả lời
    // (lỗi chính tả...) không gửi thêm thông báo. Không khớp thì ghi đè như trước; vẫn 0 dòng ⇒ không phải đánh giá của shop mình.
    const first = await this.prisma.review.updateMany({
      where: {
        id: reviewId,
        product: { shopId },
        hiddenAt: null,
        sellerRepliedAt: null,
      },
      data: { sellerReply: reply, sellerRepliedAt: new Date() },
    });
    if (first.count === 0) {
      const { count } = await this.prisma.review.updateMany({
        where: { id: reviewId, product: { shopId }, hiddenAt: null },
        data: { sellerReply: reply, sellerRepliedAt: new Date() },
      });
      if (count === 0) {
        // Không khớp hàng nào: không phải đánh giá của shop mình (404) hoặc Admin đã ẩn nó (409 — shop THẤY dòng đó trong danh sách nên
        // 404 sẽ gây hiểu nhầm). Truy vấn đọc lại cũng gắn `product.shopId`, nên không lộ đánh giá của shop khác.
        const target = await this.prisma.review.findFirst({
          where: { id: reviewId, product: { shopId } },
          select: { hiddenAt: true },
        });
        throw target?.hiddenAt ? reviewHidden() : reviewNotFound();
      }
    }

    const updated = await this.prisma.review.findFirstOrThrow({
      where: { id: reviewId, product: { shopId } },
      select: sellerReviewSelect,
    });
    if (first.count === 1) {
      await this.notificationService.notify({
        kind: 'REVIEW_REPLIED',
        reviewId,
      });
    }
    return toSellerReview(updated);
  }

  // --- Admin: ẩn / hiện đánh giá (Week11.md 5.5, D6) ------------------------------------------

  // Ẩn MỀM một đánh giá. Phần TRONG transaction (public để xử lý báo cáo gọi trong CÙNG transaction với việc đóng báo cáo): khoá dòng
  // product TRƯỚC, đặt `hidden_*`, tính lại điểm, ghi nhật ký quản trị — mọi thứ hoặc cùng thành công hoặc cùng rollback. Người gọi PHẢI
  // gọi `announceHidden` SAU khi transaction commit. Đã ẩn rồi ⇒ 409 REVIEW_ALREADY_HIDDEN (UPDATE có điều kiện `hidden_at IS NULL`
  // là ổ khoá idempotent: hai Admin cùng ẩn thì đúng một bên thắng).
  async hideInTx(
    tx: TxClient,
    input: ReviewModerationInput,
  ): Promise<{ productId: string; hiddenAt: Date }> {
    const { adminId, reviewId, reason, context } = input;
    const review = await tx.review.findUnique({
      where: { id: reviewId },
      select: { productId: true },
    });
    if (!review) throw reviewNotFound();

    const hiddenAt = new Date();
    await this.productRating.updateRating(tx, review.productId, async () => {
      const { count } = await tx.review.updateMany({
        where: { id: reviewId, hiddenAt: null },
        data: { hiddenAt, hiddenById: adminId, hiddenReason: reason },
      });
      if (count === 0) throw reviewAlreadyHidden();
    });
    await this.auditService.record(tx, {
      actorId: adminId,
      action: 'HIDE_REVIEW',
      targetType: 'REVIEW',
      targetId: reviewId,
      reason,
      meta: { productId: review.productId },
      ...context,
    });
    return { productId: review.productId, hiddenAt };
  }

  // Mở lại một đánh giá đã ẩn: đặt cả ba cột về NULL (lịch sử ẩn/hiện nằm ở nhật ký quản trị), tính lại điểm, ghi nhật ký.
  async unhideInTx(tx: TxClient, input: ReviewModerationInput): Promise<void> {
    const { adminId, reviewId, reason, context } = input;
    const review = await tx.review.findUnique({
      where: { id: reviewId },
      select: { productId: true },
    });
    if (!review) throw reviewNotFound();

    await this.productRating.updateRating(tx, review.productId, async () => {
      const { count } = await tx.review.updateMany({
        where: { id: reviewId, hiddenAt: { not: null } },
        data: { hiddenAt: null, hiddenById: null, hiddenReason: null },
      });
      if (count === 0) throw reviewNotHidden();
    });
    await this.auditService.record(tx, {
      actorId: adminId,
      action: 'UNHIDE_REVIEW',
      targetType: 'REVIEW',
      targetId: reviewId,
      reason,
      meta: { productId: review.productId },
      ...context,
    });
  }

  // Báo tác giả đánh giá của họ đã bị ẩn, SAU commit và không bao giờ ném (NotificationService.notify). Người nhận suy từ DB.
  async announceHidden(reviewId: string): Promise<void> {
    await this.notificationService.notify({
      kind: 'REVIEW_HIDDEN',
      reviewId,
    });
  }

  // Ẩn MỘT đánh giá không qua báo cáo (POST /admin/reviews/:id/hide). Trả trạng thái mới để màn quản trị cập nhật tại chỗ. Lý do là
  // văn bản Admin nhập: lỗi ghi của Prisma (mang nguyên giá trị đã ghi) được che bằng redactWriteError trước khi tới bộ lọc lỗi.
  async hide(input: ReviewModerationInput): Promise<ReviewModerationResponse> {
    let hiddenAt: Date;
    try {
      ({ hiddenAt } = await this.prisma.$transaction((tx) =>
        this.hideInTx(tx, input),
      ));
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw redactWriteError(error, 'review moderation');
    }
    await this.announceHidden(input.reviewId);
    return {
      review: {
        id: input.reviewId,
        isHidden: true,
        hiddenAt: hiddenAt.toISOString(),
      },
    };
  }

  async unhide(
    input: ReviewModerationInput,
  ): Promise<ReviewModerationResponse> {
    try {
      await this.prisma.$transaction((tx) => this.unhideInTx(tx, input));
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw redactWriteError(error, 'review moderation');
    }
    return {
      review: { id: input.reviewId, isHidden: false, hiddenAt: null },
    };
  }
}
