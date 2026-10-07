import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ShopStatusService } from '../shop/shop-status.service';
import type { ListShopsQueryDto } from './dto/list-shops-query.dto';
import type { UpdateShopStatusDto } from './dto/update-shop-status.dto';

// Select vẫn tự khai thay vì import từ ShopService — không import chéo file nội bộ giữa 2 module
// nghiệp vụ (rules/general.md mục 1, module-boundaries.spec.ts); chỉ dùng ShopStatusService (điểm duy
// nhất đổi Shop.status) qua ShopModule export. Thêm chủ shop (tên + email) để Admin biết liên hệ ai;
// route chỉ ADMIN gọi được nên lộ email chủ shop ở đây là đúng chủ đích.
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
  statusChangedAt: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { name: true, email: true } },
  // Hai trường dưới KHÔNG phải cột DB mà SUY TỪ ShopStatusHistory (Week8.md 3C.1), để Admin xét lại shop được
  // nộp lại ngay trên dòng danh sách: lý do từ chối lần GẦN NHẤT (note của dòng `→ REJECTED` mới nhất) và số
  // lần chủ shop đã bấm "gửi duyệt lại" (số dòng `REJECTED → PENDING`). Cùng 1 truy vấn (relation select lấy 1
  // dòng + _count có lọc), không N+1; toAdminShop() gỡ 2 khối thô này khỏi response.
  statusHistory: {
    where: { toStatus: 'REJECTED' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { note: true },
  },
  _count: {
    select: {
      statusHistory: { where: { fromStatus: 'REJECTED', toStatus: 'PENDING' } },
    },
  },
} satisfies Prisma.ShopSelect;

type AdminShopRow = Prisma.ShopGetPayload<{
  select: typeof adminShopSelect;
}>;

// Gỡ `statusHistory`/`_count` thô (field dùng NỘI BỘ để suy ra 2 trường dưới) trước khi trả ra response —
// khai kiểu hẹp hơn KHÔNG tự loại field dư lúc chạy (rules/backend.md mục 4), nên destructure tường minh.
function toAdminShop(row: AdminShopRow) {
  const { statusHistory, _count, ...shop } = row;
  return {
    ...shop,
    lastRejectionReason: statusHistory[0]?.note ?? null,
    resubmissionCount: _count.statusHistory,
  };
}

type AdminShopSummary = ReturnType<typeof toAdminShop>;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopStatusService: ShopStatusService,
  ) {}

  // Hàng chờ duyệt (PENDING) xếp theo MỐC VÀO HÀNG CHỜ cũ nhất trước để không ai bị bỏ quên — shop nộp lại
  // xếp theo lúc nộp lại, KHÔNG nhảy lên đầu hàng dù createdAt cũ; các trạng thái còn lại xếp theo lần đổi
  // trạng thái gần nhất trước. Dùng statusChangedAt chứ không dùng updatedAt (updatedAt đổi cả khi chủ shop
  // sửa thông tin nên thứ tự sẽ trôi). `id` làm tie-break để phân trang ổn định khi trùng mốc.
  async listShops(query: ListShopsQueryDto) {
    const { status, page, limit } = query;
    const where: Prisma.ShopWhereInput = { status };
    const orderBy: Prisma.ShopOrderByWithRelationInput[] =
      status === 'PENDING'
        ? [{ statusChangedAt: 'asc' }, { id: 'asc' }]
        : [{ statusChangedAt: 'desc' }, { id: 'desc' }];

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

    return { items: items.map(toAdminShop), total, page, limit };
  }

  // Chỉ điều phối: đọc trạng thái hiện tại rồi giao hết việc đổi trạng thái cho ShopStatusService (kiểm
  // cạnh + actor ADMIN, UPDATE ... WHERE status = <cũ> làm ổ khoá idempotent, ghi history +
  // statusReason + statusChangedAt trong cùng transaction): 2 Admin bấm đồng thời thì đúng 1 bên lật
  // được, bên kia nhận 409 thay vì ghi đè lý do/trạng thái của nhau. Cạnh của chủ shop (REJECTED →
  // PENDING) Admin không làm được — ShopStatusService từ chối vì actor sai.
  async updateShopStatus(
    adminId: string,
    shopId: string,
    dto: UpdateShopStatusDto,
  ): Promise<AdminShopSummary> {
    const from = await this.prisma.$transaction(async (tx) => {
      const current = await tx.shop.findUnique({
        where: { id: shopId },
        select: { status: true },
      });
      if (!current) {
        throw new NotFoundException('Shop not found');
      }
      await this.shopStatusService.transition(
        tx,
        shopId,
        current.status,
        dto.status,
        { type: 'ADMIN', id: adminId },
        dto.reason,
      );
      return current.status;
    });

    // Lý do là văn bản Admin tự nhập — không đưa vào log, chỉ ai/shop nào/đổi từ đâu sang đâu.
    this.logger.log(
      `Admin ${adminId} changed shop ${shopId} status ${from} -> ${dto.status}`,
    );

    return toAdminShop(
      await this.prisma.shop.findUniqueOrThrow({
        where: { id: shopId },
        select: adminShopSelect,
      }),
    );
  }
}
