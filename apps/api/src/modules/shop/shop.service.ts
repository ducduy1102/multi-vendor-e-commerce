import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SHOP_EDITABLE_STATUSES } from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { slugify } from '../../shared/utils/slugify';
import { ShopStatusService } from './shop-status.service';
import type { CreateShopDto } from './dto/create-shop.dto';
import type { ResubmitShopDto } from './dto/resubmit-shop.dto';
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
  statusChangedAt: true,
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
  private readonly logger = new Logger(ShopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopStatusService: ShopStatusService,
  ) {}

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

  // Sửa thông tin shop (không đổi slug/status). Là MỘT câu UPDATE có điều kiện, KHÔNG đọc-rồi-ghi
  // (Week8.md 3C.1): `WHERE id AND ownerId AND status IN (REJECTED, APPROVED)` — shop đang PENDING (chờ
  // duyệt) hoặc SUSPENDED (bị khoá) không sửa được, và việc kiểm trạng thái + ghi là nguyên tử nên không
  // có kẽ hở giữa 2 tab (1 tab vừa nộp lại, tab kia đang sửa). shopId lấy từ URL param, không tin client:
  // điều kiện `ownerId` nằm ngay trong câu UPDATE. 0 dòng khớp ⇒ đọc lại 1 lần để phân biệt 404 / 403 /
  // 409 SHOP_EDIT_NOT_ALLOWED (chỉ chạy ở đường lỗi).
  async updateShop(
    userId: string,
    shopId: string,
    dto: UpdateShopDto,
  ): Promise<ShopSummary> {
    const where: Prisma.ShopWhereInput = {
      id: shopId,
      ownerId: userId,
      status: { in: [...SHOP_EDITABLE_STATUSES] },
    };
    const data = this.editableFields(dto);

    // updateMany với data toàn undefined trả count = 0 mà không đụng dòng nào (đã thử với Prisma 6.19) —
    // body rỗng `{}` hợp lệ nên phải đếm riêng để vẫn kiểm được trạng thái thay vì báo nhầm 409.
    const matched =
      Object.keys(data).length === 0
        ? await this.prisma.shop.count({ where })
        : (await this.prisma.shop.updateMany({ where, data })).count;
    if (matched === 0) {
      throw await this.explainEditRefusal(userId, shopId);
    }

    return this.prisma.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: shopSelect,
    });
  }

  // "Lưu và gửi duyệt lại" (REJECTED → PENDING) — chủ shop sửa (tuỳ chọn) và nộp lại trong MỘT
  // transaction (Week8.md 3C.1). Chuyển trạng thái TRƯỚC rồi mới sửa field: câu UPDATE `WHERE status =
  // 'REJECTED'` của ShopStatusService lấy khoá hàng và thất bại sớm (409) nếu shop không còn REJECTED
  // (đã nộp lại ở tab khác...) — khi đó phần sửa field cũng rollback; sau khi lật, shop đang bị khoá hàng
  // nên không ai chen vào giữa. ShopOwnerGuard đã xác nhận `userId` là chủ shop (không kiểm lại ở đây).
  async resubmitShop(
    userId: string,
    shopId: string,
    dto: ResubmitShopDto,
  ): Promise<ShopSummary> {
    const data = this.editableFields(dto);

    await this.prisma.$transaction(async (tx) => {
      await this.shopStatusService.transition(
        tx,
        shopId,
        'REJECTED',
        'PENDING',
        { type: 'OWNER', id: userId },
      );
      if (Object.keys(data).length > 0) {
        await tx.shop.update({ where: { id: shopId }, data });
      }
    });

    this.logger.log(`Owner ${userId} resubmitted shop ${shopId}`);

    return this.prisma.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: shopSelect,
    });
  }

  // Chỉ các field chủ shop được sửa, bỏ field undefined (PATCH một phần). slug/status không bao giờ có
  // ở đây — schema đã loại ngay ở validate.
  private editableFields(
    dto: UpdateShopDto,
  ): Prisma.ShopUpdateManyMutationInput {
    const fields = {
      name: dto.name,
      description: dto.description,
      logoUrl: dto.logoUrl,
      bannerUrl: dto.bannerUrl,
    };
    return Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
  }

  private async explainEditRefusal(
    userId: string,
    shopId: string,
  ): Promise<Error> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { ownerId: true, status: true },
    });
    if (!shop) {
      return new NotFoundException('Shop not found');
    }
    if (shop.ownerId !== userId) {
      return new ForbiddenException('Not the shop owner');
    }
    return new AppException(
      409,
      'SHOP_EDIT_NOT_ALLOWED',
      `Shop details cannot be edited while the shop is ${shop.status}`,
      { status: shop.status },
    );
  }

  // Tạo shop + ghi mốc đầu `null → PENDING` trong CÙNG transaction (Week8.md 3C.1) để history luôn có đủ
  // vòng đời. Mỗi lần thử slug là 1 transaction riêng: P2002 làm hỏng transaction đang mở (Postgres không
  // cho chạy tiếp câu lệnh nào), nên vòng thử lại slug phải nằm NGOÀI transaction, như ở hai nơi gọi.
  private createShopRecord(
    data: ShopCreateData,
    slug: string,
  ): Promise<ShopSummary> {
    return this.prisma.$transaction(async (tx) => {
      const shop = await tx.shop.create({
        data: { ...data, slug },
        select: shopSelect,
      });
      await this.shopStatusService.recordCreated(tx, shop, {
        type: 'OWNER',
        id: data.ownerId,
      });
      return shop;
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
      return await this.createShopRecord(data, slug);
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
        return await this.createShopRecord(data, slug);
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
