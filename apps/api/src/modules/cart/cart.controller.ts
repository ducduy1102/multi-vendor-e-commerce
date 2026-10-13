import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserOptional,
} from '../../shared/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../shared/guards/optional-jwt-auth.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { errorExample } from '../../shared/swagger/error-examples';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { CartService } from './cart.service';
import {
  addCartItemSchema,
  cartItemsBodySchema,
  cartQuerySchema,
  cartQuoteBodySchema,
  updateCartItemSchema,
  type AddCartItemDto,
  type CartQueryDto,
  type CartQuoteDto,
  type MergeCartDto,
  type UpdateCartItemDto,
} from './dto/cart.dto';

// DTO validate bằng Zod (không phải class) nên @nestjs/swagger không tự suy ra
// schema — khai @ApiBody/@ApiResponse bằng example thủ công, giống
// ProductController/WishlistController.
const CART_VIEW_EXAMPLE = {
  shops: [
    {
      shopId: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
      shopName: 'Shop Áo Xinh',
      shopSlug: 'shop-ao-xinh',
      items: [
        {
          id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
          productVariantId: 'c4d5e6f7-1234-4a5b-8c9d-abcdef654321',
          quantity: 2,
          productId: 'd00315d7-c47b-4141-82ea-dcf585d8b762',
          productName: 'Áo thun nam',
          productSlug: 'ao-thun-nam',
          imageUrl: null,
          attributes: [{ name: 'Màu sắc', value: 'Đỏ' }],
          unitPrice: '150000',
          lineTotal: '300000',
          stock: 10,
          isAvailable: true,
        },
      ],
      subtotal: '300000',
    },
  ],
  subtotal: '300000',
  discount: { code: 'SALE10', shopId: null, amount: '30000' },
  grandTotal: '270000',
  itemCount: 1,
};

const CART_ITEM_EXAMPLE = {
  id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
  productVariantId: 'c4d5e6f7-1234-4a5b-8c9d-abcdef654321',
  quantity: 2,
};

const VOUCHER_CODE_QUERY = {
  name: 'voucherCode',
  required: false,
  description:
    'Mã giảm giá cần áp (đúng 1 mã/lần, không phân biệt hoa thường). Bỏ trống thì không áp mã.',
  example: 'SALE10',
};

// Dùng chung cho GET /cart?voucherCode và POST /cart/quote — cùng logic áp voucher
// (CartService.getCart/quote gọi chung 1 hàm validate).
const VOUCHER_APPLY_400_EXAMPLES = {
  VOUCHER_INACTIVE: {
    summary: 'VOUCHER_INACTIVE',
    value: {
      success: false,
      data: null,
      message: 'Voucher is not active',
      code: 'VOUCHER_INACTIVE',
    },
  },
  VOUCHER_EXPIRED: {
    summary: 'VOUCHER_EXPIRED',
    value: {
      success: false,
      data: null,
      message: 'Voucher has expired',
      code: 'VOUCHER_EXPIRED',
    },
  },
  VOUCHER_USAGE_LIMIT_REACHED: {
    summary: 'VOUCHER_USAGE_LIMIT_REACHED',
    value: {
      success: false,
      data: null,
      message: 'Voucher usage limit has been reached',
      code: 'VOUCHER_USAGE_LIMIT_REACHED',
    },
  },
  VOUCHER_PER_USER_LIMIT_REACHED: {
    summary: 'VOUCHER_PER_USER_LIMIT_REACHED',
    value: {
      success: false,
      data: null,
      message: 'You have reached the usage limit for this voucher',
      code: 'VOUCHER_PER_USER_LIMIT_REACHED',
    },
  },
  VOUCHER_NOT_APPLICABLE: {
    summary: 'VOUCHER_NOT_APPLICABLE',
    value: {
      success: false,
      data: null,
      message: 'Voucher does not apply to any item in your cart',
      code: 'VOUCHER_NOT_APPLICABLE',
    },
  },
  VOUCHER_BELOW_MINIMUM: {
    summary: 'VOUCHER_BELOW_MINIMUM',
    value: {
      success: false,
      data: null,
      message: 'Order amount is below the voucher minimum (200000)',
      code: 'VOUCHER_BELOW_MINIMUM',
      details: { minAmount: 200000 },
    },
  },
};

const VOUCHER_NOT_FOUND_EXAMPLE = {
  success: false,
  data: null,
  message: 'Voucher not found',
  code: 'VOUCHER_NOT_FOUND',
};

// Dùng chung cho POST /cart/items và PATCH /cart/items/:itemId — cùng 4 lý do
// 409 (CartService.assertWithinStock/addItem/updateItemQuantity).
const CART_STOCK_409_EXAMPLES = {
  INSUFFICIENT_STOCK: {
    summary: 'INSUFFICIENT_STOCK',
    value: {
      success: false,
      data: null,
      message: 'Quantity exceeds available stock (5)',
      code: 'INSUFFICIENT_STOCK',
      details: { available: 5 },
    },
  },
  CART_FULL: {
    summary: 'CART_FULL',
    value: {
      success: false,
      data: null,
      message: 'Cart is full (max 50 items)',
      code: 'CART_FULL',
      details: { maxLines: 50 },
    },
  },
  CART_ITEM_UNAVAILABLE: {
    summary: 'CART_ITEM_UNAVAILABLE',
    value: {
      success: false,
      data: null,
      message: 'This product is no longer available',
      code: 'CART_ITEM_UNAVAILABLE',
    },
  },
  CART_OWN_SHOP_ITEM: {
    summary: 'CART_OWN_SHOP_ITEM',
    value: {
      success: false,
      data: null,
      message: 'You cannot buy products from your own shop',
      code: 'CART_OWN_SHOP_ITEM',
    },
  },
};

// Giỏ hàng của user đã đăng nhập lưu ở DB, guest lưu localStorage và gọi
// POST /cart/quote (Week6.md 1.7/1.8) — mọi route trả cùng shape CartView.
@ApiTags('cart')
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Giỏ hàng của tôi — nhóm theo shop, giá/tồn kho luôn lấy live; kèm ?voucherCode để xem trước số tiền giảm',
    description:
      'Dòng thuộc shop do chính người xem làm chủ (người bán không được tự mua) có isAvailable=false và unavailableReason="OWN_SHOP": ' +
      'vẫn hiện trong giỏ để xoá được nhưng không vào tổng tiền và bị loại khỏi thanh toán.',
  })
  @ApiQuery(VOUCHER_CODE_QUERY)
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: { cart: CART_VIEW_EXAMPLE } } },
  })
  @ApiResponse({
    status: 400,
    description:
      'Query không hợp lệ (voucherCode quá 32 ký tự) hoặc mã voucher không áp dụng được (hết hạn, hết lượt, dưới mức tối thiểu...) — xem code',
    examples: {
      ...VOUCHER_APPLY_400_EXAMPLES,
      validationError: {
        summary: 'Query không hợp lệ (lỗi validate Zod, không có code)',
        value: errorExample(
          'voucherCode: String must contain at most 32 character(s)',
        ),
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 404,
    description: 'Mã voucher không tồn tại',
    schema: { example: VOUCHER_NOT_FOUND_EXAMPLE },
  })
  async getCart(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(cartQuerySchema)) query: CartQueryDto,
  ) {
    const cart = await this.cartService.getCart(user.userId, query.voucherCode);
    return { cart };
  }

  @Post('items')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Thêm 1 variant vào giỏ — đã có thì cộng dồn số lượng; chặn mềm theo tồn kho',
  })
  @ApiBody({
    schema: {
      example: {
        productVariantId: CART_ITEM_EXAMPLE.productVariantId,
        quantity: 1,
      },
    },
  })
  @ApiResponse({
    status: 201,
    schema: { example: { success: true, data: { item: CART_ITEM_EXAMPLE } } },
  })
  @ApiResponse({
    status: 400,
    description:
      'Body không hợp lệ (thiếu productVariantId, quantity < 1 hoặc không phải số nguyên)',
    schema: { example: errorExample('quantity: cart.validationQuantityMin') },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 404, description: 'Variant không tồn tại' })
  @ApiResponse({
    status: 409,
    description:
      'INSUFFICIENT_STOCK (vượt số lượng còn đặt được), CART_FULL (giỏ đã đủ 50 dòng), CART_ITEM_UNAVAILABLE (sản phẩm/shop không còn bán), CART_OWN_SHOP_ITEM (sản phẩm của chính shop mình — người bán không được tự mua) — xem code',
    examples: CART_STOCK_409_EXAMPLES,
  })
  async addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(addCartItemSchema)) dto: AddCartItemDto,
  ) {
    const item = await this.cartService.addItem(
      user.userId,
      dto.productVariantId,
      dto.quantity,
    );
    return { item };
  }

  @Patch('items/:itemId')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Đặt lại số lượng của 1 dòng trong giỏ (không cộng dồn) — chỉ giỏ của chính mình',
  })
  @ApiBody({ schema: { example: { quantity: 3 } } })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: { item: { ...CART_ITEM_EXAMPLE, quantity: 3 } },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Body không hợp lệ (quantity < 1 hoặc không phải số nguyên — muốn bỏ dòng thì dùng DELETE)',
    schema: { example: errorExample('quantity: cart.validationQuantityMin') },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 404,
    description: 'Dòng giỏ không tồn tại hoặc không thuộc giỏ của bạn',
  })
  @ApiResponse({
    status: 409,
    description:
      'INSUFFICIENT_STOCK (vượt số lượng còn đặt được), CART_FULL (giỏ đã đủ 50 dòng), CART_ITEM_UNAVAILABLE (sản phẩm/shop không còn bán), CART_OWN_SHOP_ITEM (sản phẩm của chính shop mình — người bán không được tự mua) — xem code',
    examples: CART_STOCK_409_EXAMPLES,
  })
  async updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(updateCartItemSchema)) dto: UpdateCartItemDto,
  ) {
    const item = await this.cartService.updateItemQuantity(
      user.userId,
      itemId,
      dto.quantity,
    );
    return { item };
  }

  // Idempotent — xoá dòng không tồn tại (hoặc của người khác) vẫn 200, giống
  // DELETE /wishlist/:productId. Trả 200 kèm body thay vì 204 để khớp các
  // DELETE khác của project (ProductController.archive, WishlistController).
  @Delete('items/:itemId')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Xoá 1 dòng khỏi giỏ — idempotent, chỉ giỏ của chính mình',
  })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: { removed: true } } },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
  ) {
    await this.cartService.removeItem(user.userId, itemId);
    return { removed: true };
  }

  // Không tạo resource mới nên 200 chứ không phải 201 mặc định của @Post().
  @Post('merge')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Gộp giỏ guest (localStorage) vào giỏ DB sau khi đăng nhập — cộng dồn, giới hạn theo tồn kho, bỏ qua variant không còn hoặc thuộc shop của chính mình; trả giỏ mới',
    description:
      'Giỏ trả về cùng shape GET /cart: dòng cũ thuộc shop của chính người dùng (nếu còn) có isAvailable=false và unavailableReason="OWN_SHOP".',
  })
  @ApiBody({
    schema: {
      example: {
        items: [
          { productVariantId: CART_ITEM_EXAMPLE.productVariantId, quantity: 2 },
        ],
      },
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'droppedLineCount = số dòng giỏ guest bị bỏ vì giỏ đã đủ 50 dòng (không tính dòng không khả dụng/hết hàng)',
    schema: {
      example: {
        success: true,
        data: { cart: CART_VIEW_EXAMPLE, droppedLineCount: 0 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Body không hợp lệ (thiếu items, quá 100 dòng, quantity < 1 hoặc không phải số nguyên)',
    schema: {
      example: errorExample('items.0.quantity: cart.validationQuantityMin'),
    },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async merge(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(cartItemsBodySchema)) dto: MergeCartDto,
  ) {
    const { droppedLineCount } = await this.cartService.mergeGuestCart(
      user.userId,
      dto.items,
    );
    const cart = await this.cartService.getCart(user.userId);
    return { cart, droppedLineCount };
  }

  // Public cho guest (Week6.md 1.7/1.13): client gửi items[] từ localStorage,
  // BE chỉ join giá/tồn kho live. Có JWT hợp lệ thì tận dụng userId để check
  // perUserLimit; không có thì bỏ qua nhánh đó (không 401). Không tạo
  // resource nên 200.
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Tính giỏ cho guest từ items[] (không cần đăng nhập), kèm voucherCode tuỳ chọn để xem trước số tiền giảm',
    description:
      'Khi gọi kèm đăng nhập, dòng thuộc shop của chính người xem có isAvailable=false và unavailableReason="OWN_SHOP" (người bán không được tự mua); guest không bao giờ có field này.',
  })
  @ApiBody({
    schema: {
      example: {
        items: [
          { productVariantId: CART_ITEM_EXAMPLE.productVariantId, quantity: 2 },
        ],
        voucherCode: 'SALE10',
      },
    },
  })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: { cart: CART_VIEW_EXAMPLE } } },
  })
  @ApiResponse({
    status: 400,
    description:
      'Body không hợp lệ (quantity < 1, quá 100 dòng, voucherCode quá 32 ký tự) hoặc mã voucher không áp dụng được (hết hạn, hết lượt, dưới mức tối thiểu...) — xem code',
    examples: {
      ...VOUCHER_APPLY_400_EXAMPLES,
      validationError: {
        summary: 'Body không hợp lệ (lỗi validate Zod, không có code)',
        value: errorExample('items.0.quantity: cart.validationQuantityMin'),
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Mã voucher không tồn tại',
    schema: { example: VOUCHER_NOT_FOUND_EXAMPLE },
  })
  async quote(
    @CurrentUserOptional() user: AuthenticatedUser | undefined,
    @Body(new ZodValidationPipe(cartQuoteBodySchema)) dto: CartQuoteDto,
  ) {
    const cart = await this.cartService.quote(
      dto.items,
      dto.voucherCode,
      user?.userId,
    );
    return { cart };
  }
}
