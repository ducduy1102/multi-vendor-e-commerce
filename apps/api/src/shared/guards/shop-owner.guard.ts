import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../../modules/auth/types/jwt-payload.type';

// Gán lại sau khi resolve — service tái dùng, không query lại DB lần 2 cho
// cùng việc xác định shopId/product (đúng lý do không tách guard riêng ở
// Week3.md Bước 2.6, giờ đủ ≥2 chỗ dùng nên tách, xem Week4.md Bước 1.5).
export interface ShopOwnerContext {
  shopId: string;
  productId?: string;
}

interface RequestWithShopOwner extends Request {
  user?: AuthenticatedUser;
  shopOwnerContext?: ShopOwnerContext;
}

// Luôn dùng SAU JwtAuthGuard (vd @UseGuards(JwtAuthGuard, ShopOwnerGuard)) —
// cần req.user đã set sẵn. Tự nhận diện shopId theo route, không cố định 1
// kiểu param duy nhất:
//   - Route lồng (vd POST/GET /shops/:shopId/products): đọc thẳng param
//     `shopId`.
//   - Route phẳng (vd PATCH/DELETE /products/:id): tự tra Product.shopId
//     theo param `id` (productId) — client không thể tự khai shopId ở route
//     này, đúng nguyên tắc không tin dữ liệu định danh quyền hạn từ client
//     (rules/backend.md mục 5).
@Injectable()
export class ShopOwnerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithShopOwner>();
    const { user, params } = request;
    if (!user) {
      return false;
    }

    const { shopId, productId } = await this.resolveShopId(params);

    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { ownerId: true },
    });
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }
    if (shop.ownerId !== user.userId) {
      throw new ForbiddenException('Not the shop owner');
    }

    request.shopOwnerContext = { shopId, productId };
    return true;
  }

  private async resolveShopId(
    params: Request['params'],
  ): Promise<{ shopId: string; productId?: string }> {
    if (typeof params.shopId === 'string') {
      return { shopId: params.shopId };
    }

    const productId = params.id as string;
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { shopId: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return { shopId: product.shopId, productId };
  }
}
