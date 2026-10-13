import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  createReviewSchema,
  listReviewsQuerySchema,
  replyReviewSchema,
  sellerReviewListQuerySchema,
  updateReviewSchema,
  type CreateReviewInput,
  type ListReviewsQuery,
  type ReplyReviewInput,
  type SellerReviewListQuery,
  type UpdateReviewInput,
} from '@ecommerce/types';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { ShopOwnerContext } from '../../shared/decorators/shop-owner-context.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { ShopOwnerGuard } from '../../shared/guards/shop-owner.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  errorExample,
  UNAUTHORIZED_EXAMPLE,
} from '../../shared/swagger/error-examples';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { ReviewService } from './review.service';

const REVIEW_EXAMPLE = {
  id: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
  rating: 5,
  comment: 'Giao nhanh, đóng gói cẩn thận, đúng như mô tả.',
  createdAt: '2026-10-08T10:00:00.000Z',
  editedAt: null,
  reviewerName: 'N***',
  sellerReply: null,
  sellerRepliedAt: null,
};

const SELLER_REVIEW_EXAMPLE = {
  ...REVIEW_EXAMPLE,
  sellerReply: 'Cảm ơn bạn đã ủng hộ shop!',
  sellerRepliedAt: '2026-10-08T12:00:00.000Z',
  product: {
    id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
    name: 'Áo thun cotton',
    slug: 'ao-thun-cotton',
  },
};

const SHOP_ID_PARAM = { name: 'shopId', description: 'ID shop của mình' };
const REVIEW_ID_PARAM = { name: 'id', description: 'ID đánh giá' };

const REVIEW_NOT_FOUND = errorExample('Review not found', {
  code: 'REVIEW_NOT_FOUND',
});

// Không có prefix chung ở @Controller() vì route nằm ở 3 nhánh khác nhau — `reviews` (buyer viết/sửa),
// `products/:idOrSlug/reviews` (đọc công khai), `shops/:shopId/reviews` (seller xem/trả lời) — cùng cách
// ProductController/SellerOrderController. Controller chỉ nhận request, gọi service, trả response.
@ApiTags('reviews')
@Controller()
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  // --- Người mua --------------------------------------------------------------------------------

  @Post('reviews')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Viết đánh giá cho một sản phẩm trong đơn đã COMPLETED của mình (rating 1-5, nhận xét tuỳ chọn ≤ 1000 ký tự)',
    description:
      'Điều kiện (BE kiểm, FE chỉ đọc cờ `canReview` ở chi tiết đơn): đơn của đúng người mua, đã COMPLETED, ' +
      'chứa sản phẩm đó, còn trong REVIEW_WINDOW_DAYS (mặc định 90 ngày kể từ lúc COMPLETED), chưa đánh giá. ' +
      'Điểm trung bình của sản phẩm được tính lại trong cùng giao dịch.',
  })
  @ApiBody({
    schema: {
      example: {
        orderId: 'b1b2c3d4-1234-4a5b-8c9d-abcdef000002',
        productId: SELLER_REVIEW_EXAMPLE.product.id,
        rating: 5,
        comment: REVIEW_EXAMPLE.comment,
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Đánh giá vừa tạo (tên người đánh giá đã bị che)',
    schema: { example: { success: true, data: REVIEW_EXAMPLE } },
  })
  @ApiResponse({
    status: 400,
    description:
      'Body không hợp lệ (rating ngoài 1-5 / thiếu, nhận xét > 1000 ký tự)',
    schema: { example: errorExample('rating: review.validationRatingInvalid') },
  })
  @ApiResponse({
    status: 401,
    description: 'Chưa đăng nhập',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 404,
    description: 'Đơn không tồn tại hoặc không phải của mình — không phân biệt',
    schema: {
      example: errorExample('Order not found', { code: 'ORDER_NOT_FOUND' }),
    },
  })
  @ApiResponse({
    status: 409,
    description:
      'REVIEW_NOT_ALLOWED — `details.reason`: NOT_PURCHASED (đơn không chứa sản phẩm) | ORDER_NOT_COMPLETED | WINDOW_EXPIRED | ALREADY_REVIEWED',
    schema: {
      example: errorExample('Review is not allowed: ALREADY_REVIEWED', {
        code: 'REVIEW_NOT_ALLOWED',
        details: { reason: 'ALREADY_REVIEWED' },
      }),
    },
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createReviewSchema)) body: CreateReviewInput,
  ) {
    return this.reviewService.create(user.userId, body);
  }

  @Patch('reviews/:id')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiParam(REVIEW_ID_PARAM)
  @ApiOperation({
    summary:
      'Sửa đánh giá của mình — ĐÚNG MỘT LẦN (gửi lại đủ rating + nhận xét; bỏ trống nhận xét = xoá nội dung cũ). Không có route xoá',
  })
  @ApiBody({
    schema: { example: { rating: 4, comment: 'Dùng một tuần vẫn tốt.' } },
  })
  @ApiResponse({
    status: 200,
    description: 'Đánh giá sau khi sửa (`editedAt` có giá trị)',
    schema: {
      example: {
        success: true,
        data: {
          ...REVIEW_EXAMPLE,
          rating: 4,
          editedAt: '2026-10-09T10:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Body không hợp lệ',
    schema: { example: errorExample('rating: review.validationRatingInvalid') },
  })
  @ApiResponse({
    status: 401,
    description: 'Chưa đăng nhập',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 404,
    description:
      'Đánh giá không tồn tại hoặc không phải của mình — không phân biệt',
    schema: { example: REVIEW_NOT_FOUND },
  })
  @ApiResponse({
    status: 409,
    description: 'REVIEW_EDIT_NOT_ALLOWED — đã sửa một lần rồi',
    schema: {
      example: errorExample('A review can only be edited once', {
        code: 'REVIEW_EDIT_NOT_ALLOWED',
      }),
    },
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateReviewSchema)) body: UpdateReviewInput,
  ) {
    return this.reviewService.update(user.userId, id, body);
  }

  // --- Đọc công khai ----------------------------------------------------------------------------

  // Không guard: chỉ trả dữ liệu công khai (tên đã che, không userId/email) của sản phẩm công khai.
  @Get('products/:idOrSlug/reviews')
  @ApiParam({ name: 'idOrSlug', description: 'ID hoặc slug sản phẩm' })
  @ApiOperation({
    summary:
      'Đánh giá công khai của một sản phẩm: tóm tắt (điểm trung bình, số đánh giá, phân bố 1-5 sao) + danh sách mới nhất trước, lọc theo số sao, phân trang',
    description:
      'Chỉ khi sản phẩm PUBLISHED và shop APPROVED — nếu không 404 y hệt "không tồn tại". ' +
      '`summary` luôn là của TOÀN BỘ đánh giá, không bị `rating` thu hẹp; `total` mới theo bộ lọc.',
  })
  @ApiQuery({
    name: 'rating',
    required: false,
    enum: [1, 2, 3, 4, 5],
    description: 'Chỉ lấy đánh giá đúng số sao này',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 10,
    description: 'Tối đa 50',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          summary: {
            avgRating: 4.5,
            reviewCount: 2,
            distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 1 },
          },
          items: [REVIEW_EXAMPLE],
          total: 2,
          page: 1,
          limit: 10,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Query không hợp lệ (rating ngoài 1-5, limit > 50...)',
    schema: {
      example: errorExample('rating: Number must be less than or equal to 5'),
    },
  })
  @ApiResponse({
    status: 404,
    description:
      'Sản phẩm không tồn tại, chưa PUBLISHED hoặc shop chưa APPROVED — không phân biệt',
    schema: { example: errorExample('Product not found') },
  })
  listForProduct(
    @Param('idOrSlug') idOrSlug: string,
    @Query(new ZodValidationPipe(listReviewsQuerySchema))
    query: ListReviewsQuery,
  ) {
    return this.reviewService.listForProduct(idOrSlug, query);
  }

  // --- Seller -----------------------------------------------------------------------------------

  @Get('shops/:shopId/reviews')
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiParam(SHOP_ID_PARAM)
  @ApiOperation({
    summary:
      'Đánh giá của mọi sản phẩm của shop mình (kể cả đã lưu trữ), mới nhất trước — lọc theo đã/chưa trả lời, số sao, phân trang',
  })
  @ApiQuery({
    name: 'replied',
    required: false,
    enum: ['true', 'false'],
    description: 'true = đã trả lời, false = chưa trả lời; bỏ trống = cả hai',
  })
  @ApiQuery({ name: 'rating', required: false, enum: [1, 2, 3, 4, 5] })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 10,
    description: 'Tối đa 50',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: { items: [SELLER_REVIEW_EXAMPLE], total: 1, page: 1, limit: 10 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Query không hợp lệ (replied khác true/false, limit > 50...)',
    schema: {
      example: errorExample(
        "replied: Invalid enum value. Expected 'true' | 'false', received 'maybe'",
      ),
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Chưa đăng nhập',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Không phải chủ shop',
    schema: { example: errorExample('Not the shop owner') },
  })
  @ApiResponse({
    status: 404,
    description: 'Shop không tồn tại',
    schema: { example: errorExample('Shop not found') },
  })
  listForShop(
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Query(new ZodValidationPipe(sellerReviewListQuerySchema))
    query: SellerReviewListQuery,
  ) {
    return this.reviewService.listForShop(shopId, query);
  }

  @Put('shops/:shopId/reviews/:id/reply')
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiParam(SHOP_ID_PARAM)
  @ApiParam(REVIEW_ID_PARAM)
  @ApiOperation({
    summary:
      'Trả lời một đánh giá của sản phẩm thuộc shop mình (≤ 1000 ký tự). Gọi lại = sửa câu trả lời (ghi đè, cập nhật mốc); không xoá được. Shop đang bị khoá tạm vẫn trả lời được',
  })
  @ApiBody({
    schema: { example: { reply: 'Cảm ơn bạn đã ủng hộ shop!' } },
  })
  @ApiResponse({
    status: 200,
    description: 'Đánh giá sau khi trả lời',
    schema: { example: { success: true, data: SELLER_REVIEW_EXAMPLE } },
  })
  @ApiResponse({
    status: 400,
    description: 'Thiếu câu trả lời hoặc quá 1000 ký tự',
    schema: { example: errorExample('reply: review.validationReplyRequired') },
  })
  @ApiResponse({
    status: 401,
    description: 'Chưa đăng nhập',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Không phải chủ shop',
    schema: { example: errorExample('Not the shop owner') },
  })
  @ApiResponse({
    status: 404,
    description:
      'Shop không tồn tại; hoặc đánh giá không tồn tại / thuộc sản phẩm của shop khác — không phân biệt',
    schema: { example: REVIEW_NOT_FOUND },
  })
  reply(
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Param('id') id: string,
    // Express 5: không gửi body ⇒ req.body là undefined — default câu trả lời rỗng để lỗi báo theo field `reply`.
    @Body(new ZodValidationPipe(replyReviewSchema.default({ reply: '' })))
    body: ReplyReviewInput,
  ) {
    return this.reviewService.reply(shopId, id, body.reply);
  }
}
