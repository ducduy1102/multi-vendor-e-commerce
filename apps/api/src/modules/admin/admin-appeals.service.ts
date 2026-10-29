import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  deriveAppealState,
  isAppealEpisodeCurrent,
  type AdminAppeal,
  type AdminAppealListFilter,
  type AdminAppealListResponse,
  type DecideAppealResponse,
} from '@ecommerce/types';
import { AdminAuditService } from '../../shared/audit/admin-audit.service';
import type { AuditRequestContext } from '../../shared/audit/audit-request-context';
import { AppException } from '../../shared/exceptions/app.exception';
import { NotificationService } from '../../shared/notification/notification.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { redactWriteError } from '../../shared/utils/redact-write-error';
import { isUuid } from './admin-user-id';
import { AdminService } from './admin.service';
import type { DecideAppealDto } from './dto/decide-appeal.dto';
import type { ListAdminAppealsQueryDto } from './dto/list-admin-appeals-query.dto';

// Cột của kháng nghị mà ADMIN được đọc. Thêm cột vào đây là thêm vào bề mặt lộ dữ liệu: phải kèm trường ở `adminAppealSchema`
// (packages/types) VÀ ở `toAdminAppeal` (response dựng bằng object literal tường minh, không spread).
const adminAppealSelect = {
  id: true,
  targetId: true,
  status: true,
  message: true,
  decisionNote: true,
  decidedById: true,
  createdAt: true,
  decidedAt: true,
  moderationEventAt: true,
} satisfies Prisma.AppealSelect;

type AdminAppealRow = Prisma.AppealGetPayload<{
  select: typeof adminAppealSelect;
}>;

// Shop và chủ shop của kháng nghị. Chỉ tên + email chủ shop (Admin được thấy, như danh sách shop), không SĐT hay địa chỉ.
const appealShopSelect = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  status: true,
  statusReason: true,
  statusChangedAt: true,
  owner: { select: { name: true, email: true } },
} satisfies Prisma.ShopSelect;

type AppealShopRow = Prisma.ShopGetPayload<{ select: typeof appealShopSelect }>;

function toAdminAppeal(
  row: AdminAppealRow,
  shop: AppealShopRow,
  decidedByName: string | null,
): AdminAppeal {
  return {
    id: row.id,
    state: deriveAppealState(
      row.status,
      isAppealEpisodeCurrent(shop, row.moderationEventAt),
    ),
    message: row.message,
    decisionNote: row.decisionNote,
    decidedByName,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    moderationEventAt: row.moderationEventAt.toISOString(),
    shop: {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      logoUrl: shop.logoUrl,
      status: shop.status,
      statusReason: shop.statusReason,
    },
    owner: { name: shop.owner.name, email: shop.owner.email },
  };
}

// Điều kiện lọc theo bộ lọc của hàng đợi — các mảnh SQL CỐ ĐỊNH chọn theo giá trị enum đã validate, không bao giờ ghép chuỗi từ
// input. PENDING = còn chờ VÀ lần khoá còn diễn ra; CLOSED = còn chờ nhưng lần khoá đã kết thúc (cùng luật `isAppealEpisodeCurrent`
// ở packages/types, viết lại bằng SQL để lọc và phân trang ở DB).
function filterSql(filter: AdminAppealListFilter): Prisma.Sql {
  switch (filter) {
    case 'PENDING':
      return Prisma.sql`a.status = 'PENDING' AND s.status = 'SUSPENDED' AND s.status_changed_at = a.moderation_event_at`;
    case 'CLOSED':
      return Prisma.sql`a.status = 'PENDING' AND (s.status <> 'SUSPENDED' OR s.status_changed_at <> a.moderation_event_at)`;
    case 'ACCEPTED':
      return Prisma.sql`a.status = 'ACCEPTED'`;
    case 'REJECTED':
      return Prisma.sql`a.status = 'REJECTED'`;
  }
}

// Hàng chờ xếp cũ nhất trước (không ai bị bỏ quên); các bộ lọc còn lại mới nhất trước. `id` là khoá phụ để phân trang không
// trùng/mất khi hai kháng nghị cùng mili-giây.
function orderSql(filter: AdminAppealListFilter): Prisma.Sql {
  switch (filter) {
    case 'PENDING':
      return Prisma.sql`a.created_at ASC, a.id ASC`;
    case 'CLOSED':
      return Prisma.sql`a.created_at DESC, a.id DESC`;
    case 'ACCEPTED':
    case 'REJECTED':
      return Prisma.sql`a.decided_at DESC, a.id DESC`;
  }
}

const notFound = () =>
  new AppException(404, 'APPEAL_NOT_FOUND', 'Appeal not found');

// Hàng đợi và quyết định kháng nghị của shop (Week11.md 4.6, D15), phía ADMIN. Quyền ở controller (JwtAuthGuard + RolesGuard).
// Chấp nhận = mở khoá shop (SUSPENDED → APPROVED) qua đúng luật của `AdminService.changeShopStatusInTx` (chủ shop phải còn
// ACTIVE) TRONG CÙNG transaction với việc đóng kháng nghị: hoặc cả hai thành công hoặc không cái nào. Lời kháng nghị và ghi chú là
// văn bản riêng tư: không vào log (chỉ id), lỗi ghi của Prisma được che bằng redactWriteError.
@Injectable()
export class AdminAppealsService {
  private readonly logger = new Logger(AdminAppealsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminService: AdminService,
    private readonly auditService: AdminAuditService,
    private readonly notificationService: NotificationService,
  ) {}

  async list(
    query: ListAdminAppealsQueryDto,
  ): Promise<AdminAppealListResponse> {
    const { status, page, limit } = query;
    const filter = filterSql(status);
    const [countRows, idRows] = await Promise.all([
      this.prisma.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT count(*) AS total FROM appeals a JOIN shops s ON s.id = a.target_id WHERE a.target_type = 'SHOP' AND ${filter}`,
      ),
      this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT a.id FROM appeals a JOIN shops s ON s.id = a.target_id WHERE a.target_type = 'SHOP' AND ${filter} ORDER BY ${orderSql(status)} LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      ),
    ]);

    const ids = idRows.map((row) => row.id);
    const items = await this.loadByIds(ids);
    return { items, total: Number(countRows[0]?.total ?? 0), page, limit };
  }

  async decide(
    adminId: string,
    appealId: string,
    dto: DecideAppealDto,
    auditContext: AuditRequestContext = {},
  ): Promise<DecideAppealResponse> {
    // Id sai dạng (kể cả có NUL mà Postgres không nhận và sẽ thành 500) ra cùng một 404 như id không tồn tại.
    if (!isUuid(appealId)) throw notFound();

    let shopId: string;
    try {
      shopId = await this.prisma.$transaction(async (tx) => {
        // Đua giữa hai Admin có HAI chốt độc lập, mỗi chốt riêng đã đủ (test đua chỉ đỏ khi phá cả hai): `FOR UPDATE` làm người thứ
        // hai chờ rồi thấy status khác PENDING ⇒ 409 mà không làm việc thừa; `UPDATE ... WHERE status = 'PENDING'` bên dưới là
        // lưới cuối nếu khoá bị bỏ — bên thua nhận count = 0 và rollback cả việc mở khoá shop.
        const rows = await tx.$queryRaw<
          {
            status: string;
            target_type: string;
            target_id: string;
            moderation_event_at: Date;
          }[]
        >(
          Prisma.sql`SELECT status, target_type, target_id, moderation_event_at FROM appeals WHERE id = ${appealId} FOR UPDATE`,
        );
        const appeal = rows[0];
        // Kháng nghị sản phẩm (5.8) chưa có luồng quyết định ở đây.
        if (!appeal || appeal.target_type !== 'SHOP') throw notFound();
        if (appeal.status !== 'PENDING') {
          throw new AppException(
            409,
            'APPEAL_ALREADY_DECIDED',
            'This appeal was already decided',
          );
        }

        const shop = await tx.shop.findUnique({
          where: { id: appeal.target_id },
          select: { status: true, statusChangedAt: true },
        });
        // Lần khoá mà kháng nghị nhắm tới đã kết thúc (shop được mở khoá bằng đường khác, hoặc bị khoá lại một lần khác): không còn
        // gì để chấp nhận hay từ chối.
        if (
          !shop ||
          !isAppealEpisodeCurrent(shop, appeal.moderation_event_at)
        ) {
          throw new AppException(
            409,
            'APPEAL_TARGET_CHANGED',
            'The suspension this appeal refers to is no longer in effect',
          );
        }

        if (dto.decision === 'ACCEPT') {
          await this.adminService.changeShopStatusInTx(
            tx,
            adminId,
            appeal.target_id,
            { status: 'APPROVED' },
          );
        }

        const { count } = await tx.appeal.updateMany({
          where: { id: appealId, status: 'PENDING' },
          data: {
            status: dto.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
            decidedById: adminId,
            decidedAt: new Date(),
            decisionNote: dto.note ?? null,
          },
        });
        // Đã giữ khoá hàng nên bình thường không thể là 0; nếu có thì rollback thay vì ghi nhật ký cho việc không xảy ra.
        if (count !== 1) {
          throw new AppException(
            409,
            'APPEAL_ALREADY_DECIDED',
            'This appeal was already decided',
          );
        }

        // Cùng transaction: quyết định mà không có dấu vết thì không được tồn tại (ghi lỗi ⇒ rollback cả quyết định).
        await this.auditService.record(tx, {
          actorId: adminId,
          action: 'DECIDE_APPEAL',
          targetType: 'APPEAL',
          targetId: appealId,
          ...(dto.note ? { reason: dto.note } : {}),
          meta: { decision: dto.decision, shopId: appeal.target_id },
          ...auditContext,
        });
        return appeal.target_id;
      });
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw redactWriteError(error, 'appeal decision');
    }

    // Chỉ id/quyết định: lời kháng nghị và ghi chú không vào log.
    this.logger.log(
      `Admin ${adminId} ${dto.decision === 'ACCEPT' ? 'accepted' : 'rejected'} appeal ${appealId} of shop ${shopId}`,
    );

    // SAU commit, không bao giờ ném: chấp nhận ⇒ thông báo + email "shop được mở khoá" của luồng duyệt shop; rồi báo chủ shop kết quả.
    if (dto.decision === 'ACCEPT') {
      await this.adminService.announceShopStatusChange(
        adminId,
        shopId,
        'SUSPENDED',
        { status: 'APPROVED' },
      );
    }
    await this.notificationService.notify({
      kind: 'APPEAL_DECIDED',
      appealId,
      shopId,
      decision: dto.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
    });

    const [appeal] = await this.loadByIds([appealId]);
    return { appeal };
  }

  // Đọc kháng nghị theo id, GIỮ thứ tự của `ids`: một truy vấn kháng nghị, một truy vấn shop (kèm chủ shop), một truy vấn tên Admin
  // (chỉ id + name, không email). Shop đã bị xoá thì bỏ kháng nghị đó (không có gì để hiển thị).
  private async loadByIds(ids: string[]): Promise<AdminAppeal[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.appeal.findMany({
      where: { id: { in: ids } },
      select: adminAppealSelect,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    const shopIds = [...new Set(rows.map((row) => row.targetId))];
    const adminIds = [
      ...new Set(
        rows.flatMap((row) => (row.decidedById ? [row.decidedById] : [])),
      ),
    ];
    const [shops, admins] = await Promise.all([
      this.prisma.shop.findMany({
        where: { id: { in: shopIds } },
        select: appealShopSelect,
      }),
      adminIds.length === 0
        ? Promise.resolve<{ id: string; name: string }[]>([])
        : this.prisma.user.findMany({
            where: { id: { in: adminIds } },
            select: { id: true, name: true },
          }),
    ]);
    const shopById = new Map(shops.map((shop) => [shop.id, shop]));
    const adminName = new Map(admins.map((admin) => [admin.id, admin.name]));

    const items: AdminAppeal[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      const shop = row ? shopById.get(row.targetId) : undefined;
      if (!row || !shop) continue;
      items.push(
        toAdminAppeal(
          row,
          shop,
          row.decidedById ? (adminName.get(row.decidedById) ?? null) : null,
        ),
      );
    }
    return items;
  }
}
