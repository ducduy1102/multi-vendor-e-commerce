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
  })
  @ApiQuery(VOUCHER_CODE_QUERY)
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: { cart: CART_VIEW_EXAMPLE } } },
  })
  @ApiResponse({
    status: 400,
    description:
      'Mã voucher không áp dụng được (hết hạn, hết lượt, dưới mức tối thiểu...) — message nêu rõ lý do',
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 404, description: 'Mã voucher không tồn tại' })
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
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 404, description: 'Variant không tồn tại' })
  @ApiResponse({
    status: 409,
    description: 'Vượt tồn kho, hoặc sản phẩm/shop không còn bán',
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
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 404,
    description: 'Dòng giỏ không tồn tại hoặc không thuộc giỏ của bạn',
  })
  @ApiResponse({
    status: 409,
    description: 'Vượt tồn kho, hoặc sản phẩm/shop không còn bán',
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
      'Gộp giỏ guest (localStorage) vào giỏ DB sau khi đăng nhập — cộng dồn, giới hạn theo tồn kho, bỏ qua variant không còn; trả giỏ mới',
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
    schema: { example: { success: true, data: { cart: CART_VIEW_EXAMPLE } } },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async merge(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(cartItemsBodySchema)) dto: MergeCartDto,
  ) {
    await this.cartService.mergeGuestCart(user.userId, dto.items);
    const cart = await this.cartService.getCart(user.userId);
    return { cart };
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
      'Mã voucher không áp dụng được — message nêu rõ lý do (hết hạn, hết lượt, dưới mức tối thiểu...)',
  })
  @ApiResponse({ status: 404, description: 'Mã voucher không tồn tại' })
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
