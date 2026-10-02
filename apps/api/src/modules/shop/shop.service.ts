import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { slugify } from '../../shared/utils/slugify';
import type { CreateShopDto } from './dto/create-shop.dto';
import type { UpdateShopDto } from './dto/update-shop.dto';

const shopSelect = {
  id: true,
  ownerId: true,
  name: true,
  slug: true,
  logoUrl: true,
  bannerUrl: true,
  description: true,
  status: true,
  statusReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ShopSelect;

type ShopSummary = Prisma.ShopGetPayload<{ select: typeof shopSelect }>;

interface ShopCreateData {
  ownerId: string;
  name: string;
  description?: string;
  logoUrl?: string;
  bannerUrl?: string;
}

// Đủ thử slug, slug-2 .. slug-20 trước khi coi là bế tắc — chỉ áp dụng cho
// slug tự sinh từ name (Bước 2.3), không áp dụng cho slug người dùng tự nhập
// (xem createWithExplicitSlug, trùng là báo lỗi thẳng, không tự đổi hộ).
const MAX_GENERATED_SLUG_ATTEMPTS = 20;

@Injectable()
export class ShopService {
  constructor(private readonly prisma: PrismaService) {}

  // Giới hạn 1 shop/user (Week3.md Bước 1.6) chỉ enforce ở đây, không có
  // @unique trên Shop.ownerId — chấp nhận khe hở race hiếm gặp giữa 2 request
  // gần như đồng thời, xem lý do đầy đủ ở Bước 1.6.
  async createShop(userId: string, dto: CreateShopDto): Promise<ShopSummary> {
    const existingShop = await this.prisma.shop.findFirst({
      where: { ownerId: userId },
      select: { id: true },
    });
    if (existingShop) {
      throw new ConflictException('User already owns a shop');
    }

    const data: ShopCreateData = {
      ownerId: userId,
      name: dto.name,
      description: dto.description,
      logoUrl: dto.logoUrl,
      bannerUrl: dto.bannerUrl,
    };

    if (dto.slug) {
      return this.createWithExplicitSlug(data, dto.slug);
    }
    return this.createWithGeneratedSlug(data, slugify(dto.name));
  }

  async getMyShop(userId: string): Promise<ShopSummary> {
    const shop = await this.prisma.shop.findFirst({
      where: { ownerId: userId },
      select: shopSelect,
    });
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }
    return shop;
  }

  // shopId lấy từ URL param, không tin client — đối chiếu ownerId với userId
  // từ JWT ngay trong service (không tách guard riêng, xem Week3.md Bước 2.6).
  async updateShop(
    userId: string,
    shopId: string,
    dto: UpdateShopDto,
  ): Promise<ShopSummary> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, ownerId: true },
    });
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }
    if (shop.ownerId !== userId) {
      throw new ForbiddenException('Not the shop owner');
    }

    return this.prisma.shop.update({
      where: { id: shopId },
      data: {
        name: dto.name,
        description: dto.description,
        logoUrl: dto.logoUrl,
        bannerUrl: dto.bannerUrl,
      },
      select: shopSelect,
    });
  }

  private async createWithExplicitSlug(
    data: ShopCreateData,
    slug: string,
  ): Promise<ShopSummary> {
    const taken = await this.prisma.shop.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException('Slug already exists');
    }

    try {
      return await this.prisma.shop.create({
        data: { ...data, slug },
        select: shopSelect,
      });
    } catch (error) {
      if (this.isSlugConflict(error)) {
        throw new ConflictException('Slug already exists');
      }
      throw error;
    }
  }

  private async createWithGeneratedSlug(
    data: ShopCreateData,
    baseSlug: string,
  ): Promise<ShopSummary> {
    for (let attempt = 0; attempt < MAX_GENERATED_SLUG_ATTEMPTS; attempt++) {
      const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
      const taken = await this.prisma.shop.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (taken) {
        continue;
      }

      try {
        return await this.prisma.shop.create({
          data: { ...data, slug },
          select: shopSelect,
        });
      } catch (error) {
        // Race: 2 request generate cùng slug gần như đồng thời, cả 2 đều pass
        // check "taken" ở trên trước khi 1 trong 2 commit trước — không tin
        // riêng bước check, thử hậu tố kế tiếp ở vòng lặp sau thay vì để lỗi
        // 500 lộ ra ngoài.
        if (!this.isSlugConflict(error)) {
          throw error;
        }
      }
    }

    throw new ConflictException('Slug already exists');
  }

  // Shop chỉ có 1 unique constraint ngoài id (slug) nên P2002 ở bảng này chắc
  // chắn do slug, không cần soi thêm error.meta.target.
  private isSlugConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
