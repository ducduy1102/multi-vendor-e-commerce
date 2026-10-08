import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { WishlistService } from './wishlist.service';

// DTO validate bằng Zod (không phải class), @nestjs/swagger không tự suy ra
// schema được nên khai @ApiResponse bằng example thủ công (giống
// ProductController/ShopController).
const WISHLIST_ITEM_EXAMPLE = {
  id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
  categoryId: 'd00315d7-c47b-4141-82ea-dcf585d8b762',
  name: 'Áo thun nam',
  slug: 'ao-thun-nam',
  minPrice: '150000',
  maxPrice: '150000',
  imageUrl: null,
  avgRating: 4.5,
  reviewCount: 12,
  isAvailable: true,
};

// Week5.md Bước 1.12: Wishlist chỉ cho user đã đăng nhập (guest không wishlist
// được, khác giỏ hàng) — mọi route đều bắt buộc JwtAuthGuard, không có route
// public/optional-auth nào ở module này.
@ApiTags('wishlist')
@Controller('wishlist')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth('access_token')
export class WishlistController {
  constructor(private readonly wishlistService: WishlistService) {}

  // Idempotent — thêm rồi thêm lại không lỗi (Bước 2.6). Trả cùng shape
  // {isWishlisted} với DELETE/GET status để FE đồng bộ state từ API nào
  // cũng được, không cần phân biệt theo route gọi.
  @Post(':productId')
  @ApiOperation({ summary: 'Thêm 1 product vào wishlist — idempotent' })
  @ApiResponse({
    status: 201,
    schema: { example: { success: true, data: { isWishlisted: true } } },
  })
  async add(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId') productId: string,
  ) {
    await this.wishlistService.addToWishlist(user.userId, productId);
    return { isWishlisted: true };
  }

  // Idempotent — xoá khi chưa từng thêm cũng không lỗi (Bước 2.6).
  @Delete(':productId')
  @ApiOperation({
    summary: 'Bỏ 1 product khỏi wishlist — idempotent',
  })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: { isWishlisted: false } } },
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId') productId: string,
  ) {
    await this.wishlistService.removeFromWishlist(user.userId, productId);
    return { isWishlisted: false };
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách wishlist của tôi' })
  @ApiResponse({
    status: 200,
    schema: {
      example: { success: true, data: { items: [WISHLIST_ITEM_EXAMPLE] } },
    },
  })
  async listMine(@CurrentUser() user: AuthenticatedUser) {
    const items = await this.wishlistService.listMyWishlist(user.userId);
    return { items };
  }

  // Dùng lúc mount WishlistButton ở trang chi tiết (Bước 3.4) để biết trạng
  // thái ban đầu (đã thích hay chưa), theo quyết định 1.18.
  @Get(':productId/status')
  @ApiOperation({ summary: 'Product hiện tại đã có trong wishlist chưa' })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: { isWishlisted: false } } },
  })
  async status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId') productId: string,
  ) {
    const isWishlisted = await this.wishlistService.checkIsWishlisted(
      user.userId,
      productId,
    );
    return { isWishlisted };
  }
}
