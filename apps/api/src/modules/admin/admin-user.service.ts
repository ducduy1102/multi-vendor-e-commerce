import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ADMIN_USER_DETAIL_SHOPS_LIMIT,
  ADMIN_USER_HISTORY_LIMIT,
  adminUserHistoryEntrySchema,
  type AdminUser,
  type AdminUserDetail,
  type AdminUserHistoryEntry,
  type AdminUserListResponse,
} from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { buildAdminUserWhere } from './admin-user-query';
import type { ListUsersQueryDto } from './dto/list-users-query.dto';

// Cột người dùng được đọc cho Admin. Chỉ những cột cần cho `AdminUser`: KHÔNG bao giờ `passwordHash`, `refreshTokenHash`
// hay các cột token xác thực email / đặt lại mật khẩu — kể cả khi Zod ở FE sẽ bỏ chúng, chúng không được rời DB. Thêm cột
// vào đây là thêm vào bề mặt lộ dữ liệu: phải kèm trường tương ứng ở `adminUserSchema` (packages/types).
const adminUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  accountStatus: true,
  statusReason: true,
  statusChangedAt: true,
  // Chỉ dùng NỘI BỘ để suy ra `isEmailVerified`: mốc xác thực không được lộ ra response (toAdminUser dựng object thủ công).
  emailVerifiedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type AdminUserRow = Prisma.UserGetPayload<{ select: typeof adminUserSelect }>;

// Dựng response bằng object literal TƯỜNG MINH (không spread): trường nào không được viết ra ở đây thì không thể lọt vào
// response, kể cả khi `select` ở trên bị mở rộng sau này (rules/backend.md mục 4).
export function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    accountStatus: row.accountStatus,
    statusReason: row.statusReason,
    statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
    isEmailVerified: row.emailVerifiedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

const adminUserDetailSelect = {
  ...adminUserSelect,
  locale: true,
  _count: { select: { orders: true } },
  shops: {
    select: { id: true, name: true, slug: true, status: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: ADMIN_USER_DETAIL_SHOPS_LIMIT,
  },
} satisfies Prisma.UserSelect;

// `meta` của nhật ký là Json và đã được Zod ép lúc ghi (chỉ id / mã enum / số / cờ). Dữ liệu hỏng hoặc lạ (ghi tay vào DB)
// ra `{}` thay vì đi tiếp tới FE — cùng nguyên tắc "dữ liệu lạ không rời khỏi API" của thông báo.
const historyMetaSchema = adminUserHistoryEntrySchema.shape.meta;

function toHistoryMeta(value: Prisma.JsonValue): AdminUserHistoryEntry['meta'] {
  const parsed = historyMetaSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

// Id người dùng luôn là UUID. Kiểm dạng TRƯỚC khi chạm DB để mọi id sai (kể cả có ký tự NUL mà Postgres không nhận và sẽ
// thành 500) ra cùng một 404 như id không tồn tại — không có "oracle" phân biệt id sai dạng với id không có thật.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AdminUserService {
  constructor(private readonly prisma: PrismaService) {}

  // Danh sách người dùng cho Admin: tìm theo email / tên (không phân biệt hoa-thường và dấu), lọc vai và trạng thái, mới
  // tạo trước, phân trang offset như /admin/shops. Ba truy vấn: (1) id của TRANG HIỆN TẠI và (2) tổng số khớp — cùng một
  // mệnh đề WHERE nên không lệch nhau — chạy song song, rồi (3) đọc các cột cần dùng bằng `select` hẹp của Prisma. Tìm
  // kiếm cần SQL thuần (unaccent) nên bước lọc/sắp xếp/cắt trang nằm ở (1); id là khoá phụ của thứ tự nên phân trang ổn
  // định khi nhiều người cùng mili-giây. Không có chỉ mục hỗ trợ `%q%` — xem ghi chú đo ở Week11.md 3.2.
  async listUsers(query: ListUsersQueryDto): Promise<AdminUserListResponse> {
    const { page, limit } = query;
    const where = buildAdminUserWhere(query);

    const [pageRows, totalRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM users ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      ),
      this.prisma.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT count(*) AS total FROM users ${where}`,
      ),
    ]);
    const total = Number(totalRows[0]?.total ?? 0);

    const ids = pageRows.map((row) => row.id);
    const rows =
      ids.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: ids } },
            select: adminUserSelect,
          });
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Giữ đúng thứ tự của truy vấn (1); người dùng bị xoá giữa hai truy vấn thì bỏ qua.
    const items = ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [toAdminUser(row)] : [];
    });

    return { items, total, page, limit };
  }

  // Chi tiết một người dùng: tài khoản + shop sở hữu + số đơn đã đặt + lịch sử nhật ký quản trị về CHÍNH tài khoản này
  // (mới nhất trước). `ip`/`user_agent` của Admin trong nhật ký không được chọn. Ghi chú nội bộ sẽ thêm ở 4.3.
  async getUser(id: string): Promise<AdminUserDetail> {
    if (!UUID_PATTERN.test(id)) throw userNotFound();

    const [user, history] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id },
        select: adminUserDetailSelect,
      }),
      this.prisma.adminAuditLog.findMany({
        where: { targetType: 'USER', targetId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: ADMIN_USER_HISTORY_LIMIT,
        select: {
          id: true,
          action: true,
          actorId: true,
          reason: true,
          meta: true,
          createdAt: true,
        },
      }),
    ]);
    if (!user) throw userNotFound();

    // Nhật ký không có khoá ngoại tới users (có chủ đích) nên tên Admin tra riêng bằng MỘT truy vấn cho mọi dòng; Admin đã
    // bị xoá thì `actorName` là null.
    const actorIds = [...new Set(history.map((entry) => entry.actorId))];
    const actors =
      actorIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true },
          });
    const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));

    return {
      ...toAdminUser(user),
      locale: user.locale,
      orderCount: user._count.orders,
      shops: user.shops.map((shop) => ({
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        status: shop.status,
      })),
      history: history.map((entry) => ({
        id: entry.id,
        action: entry.action,
        actorId: entry.actorId,
        actorName: actorNames.get(entry.actorId) ?? null,
        reason: entry.reason,
        meta: toHistoryMeta(entry.meta),
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }
}

function userNotFound(): AppException<'USER_NOT_FOUND'> {
  return new AppException(404, 'USER_NOT_FOUND', 'User not found');
}
