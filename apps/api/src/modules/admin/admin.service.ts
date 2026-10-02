import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type ShopStatus } from '@prisma/client';
import {
  ADMIN_SHOP_STATUSES_REQUIRING_REASON,
  isValidShopStatusTransition,
} from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { ListShopsQueryDto } from './dto/list-shops-query.dto';
import type { UpdateShopStatusDto } from './dto/update-shop-status.dto';

// Tự khai select thay vì import từ ShopService — không import chéo file nội bộ giữa 2 module nghiệp
// vụ (rules/general.md mục 1, module-boundaries.spec.ts). Thêm chủ shop (tên + email) để Admin biết
// liên hệ ai; route chỉ ADMIN gọi được nên lộ email chủ shop ở đây là đúng chủ đích.
const adminShopSelect = {
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
  owner: { select: { name: true, email: true } },
} satisfies Prisma.ShopSelect;

type AdminShopSummary = Prisma.ShopGetPayload<{
  select: typeof adminShopSelect;
}>;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Hàng chờ duyệt (PENDING) xếp cũ nhất trước để không ai bị bỏ quên; các trạng thái còn lại xếp
  // theo lần đổi trạng thái gần nhất trước. `id` làm tie-break để phân trang ổn định khi trùng mốc.
  async listShops(query: ListShopsQueryDto) {
    const { status, page, limit } = query;
    const where: Prisma.ShopWhereInput = { status };
    const orderBy: Prisma.ShopOrderByWithRelationInput[] =
      status === 'PENDING'
        ? [{ createdAt: 'asc' }, { id: 'asc' }]
        : [{ updatedAt: 'desc' }, { id: 'desc' }];

    const [items, total] = await Promise.all([
      this.prisma.shop.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: adminShopSelect,
      }),
      this.prisma.shop.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  // Chuyển trạng thái = UPDATE ... WHERE id AND status = <cũ> làm ổ khoá idempotent (cùng pattern
  // OrderStatusService): 2 Admin bấm đồng thời thì đúng 1 bên lật được, bên kia nhận 409 thay vì ghi
  // đè lý do/trạng thái của nhau. Bảng cạnh hợp lệ là SHOP_STATUS_TRANSITIONS (packages/types).
  async updateShopStatus(
    adminId: string,
    shopId: string,
    dto: UpdateShopStatusDto,
  ): Promise<AdminShopSummary> {
    const current = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { status: true },
    });
    if (!current) {
      throw new NotFoundException('Shop not found');
    }
    if (!isValidShopStatusTransition(current.status, dto.status)) {
      throw this.invalidTransition(current.status, dto.status);
    }

    // Duyệt/mở khoá luôn xoá lý do cũ; từ chối/khoá ghi lý do mới (schema đã bắt buộc có lý do).
    const statusReason = ADMIN_SHOP_STATUSES_REQUIRING_REASON.includes(
      dto.status,
    )
      ? (dto.reason ?? null)
      : null;

    const { count } = await this.prisma.shop.updateMany({
      where: { id: shopId, status: current.status },
      data: { status: dto.status, statusReason },
    });
    if (count === 0) {
      throw this.invalidTransition(current.status, dto.status);
    }

    // Lý do là văn bản Admin tự nhập — không đưa vào log, chỉ ai/shop nào/đổi từ đâu sang đâu.
    this.logger.log(
      `Admin ${adminId} changed shop ${shopId} status ${current.status} -> ${dto.status}`,
    );

    return this.prisma.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: adminShopSelect,
    });
  }

  private invalidTransition(from: ShopStatus, to: ShopStatus): AppException {
    return new AppException(
      409,
      'SHOP_INVALID_TRANSITION',
      `Cannot change shop status from ${from} to ${to}`,
    );
  }
}
