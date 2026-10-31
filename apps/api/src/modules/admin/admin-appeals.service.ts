import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  deriveAppealState,
  isAppealEpisodeCurrent,
  isProductAppealEpisodeCurrent,
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
import type { TxClient } from '../../shared/prisma/tx-client';
import { redactWriteError } from '../../shared/utils/redact-write-error';
import { ProductModerationService } from '../product/product-moderation.service';
import { isUuid } from './admin-user-id';
import { AdminService } from './admin.service';
import type { DecideAppealDto } from './dto/decide-appeal.dto';
import type { ListAdminAppealsQueryDto } from './dto/list-admin-appeals-query.dto';

// Cột của kháng nghị mà ADMIN được đọc. Thêm cột vào đây là thêm vào bề mặt lộ dữ liệu: phải kèm trường ở `adminAppealSchema`
// (packages/types) VÀ ở `toAdminAppeal` (response dựng bằng object literal tường minh, không spread).
const adminAppealSelect = {
  id: true,
  targetType: true,
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

// Sản phẩm của kháng nghị sản phẩm (Week11.md 5.8): chỉ những cột hàng đợi hiển thị + `shopId` để tìm shop/chủ shop và `status`/`takenDownAt`
// để suy ra "lần gỡ còn hiệu lực không". Không mô tả, giá hay ảnh.
const appealProductSelect = {
  id: true,
  shopId: true,
  name: true,
  slug: true,
  status: true,
  takenDownAt: true,
  takenDownReason: true,
} satisfies Prisma.ProductSelect;

type AppealProductRow = Prisma.ProductGetPayload<{
  select: typeof appealProductSelect;
}>;

function toAdminAppeal(
  row: AdminAppealRow,
  shop: AppealShopRow,
  product: AppealProductRow | null,
  decidedByName: string | null,
): AdminAppeal {
  const isEpisodeCurrent =
    row.targetType === 'PRODUCT'
      ? product !== null &&
        isProductAppealEpisodeCurrent(product, row.moderationEventAt)
      : isAppealEpisodeCurrent(shop, row.moderationEventAt);
  return {
    id: row.id,
    targetType: row.targetType,
    state: deriveAppealState(row.status, isEpisodeCurrent),
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
    product: product
      ? {
          id: product.id,
          name: product.name,
          slug: product.slug,
          takenDownReason: product.takenDownReason,
        }
      : null,
    owner: { name: shop.owner.name, email: shop.owner.email },
  };
}

// Nguồn dữ liệu chung của đếm và phân trang: kháng nghị + (kháng nghị sản phẩm) sản phẩm + shop liên quan. Shop của kháng nghị shop là chính
// `target_id`; shop của kháng nghị sản phẩm là `products.shop_id`. INNER JOIN shops nên kháng nghị mà đối tượng (hoặc shop của nó) không còn
// bị bỏ khỏi cả đếm lẫn danh sách — khớp `loadByIds`, để `total` không bao giờ lớn hơn số dòng có thể xem.
const APPEAL_SOURCE_SQL = Prisma.sql`appeals a
  LEFT JOIN products p ON a.target_type = 'PRODUCT' AND p.id = a.target_id
  JOIN shops s ON s.id = CASE a.target_type WHEN 'SHOP' THEN a.target_id ELSE p.shop_id END`;

// Lần xử lý mà kháng nghị nhắm tới còn đang diễn ra không (cùng luật `isAppealEpisodeCurrent` / `isProductAppealEpisodeCurrent` ở
// packages/types, viết lại bằng SQL để lọc và phân trang ở DB). Mọi nhánh đều ra TRUE/FALSE (không NULL) nên `NOT` an toàn.
const EPISODE_CURRENT_SQL = Prisma.sql`(
  (a.target_type = 'SHOP' AND s.status = 'SUSPENDED' AND s.status_changed_at = a.moderation_event_at)
  OR (a.target_type = 'PRODUCT' AND p.status = 'TAKEN_DOWN' AND p.taken_down_at = a.moderation_event_at)
)`;

// Điều kiện lọc theo bộ lọc của hàng đợi — các mảnh SQL CỐ ĐỊNH chọn theo giá trị enum đã validate, không bao giờ ghép chuỗi từ
// input. PENDING = còn chờ VÀ lần xử lý còn diễn ra; CLOSED = còn chờ nhưng lần xử lý đã kết thúc.
function filterSql(filter: AdminAppealListFilter): Prisma.Sql {
  switch (filter) {
    case 'PENDING':
      return Prisma.sql`a.status = 'PENDING' AND ${EPISODE_CURRENT_SQL}`;
    case 'CLOSED':
      return Prisma.sql`a.status = 'PENDING' AND NOT ${EPISODE_CURRENT_SQL}`;
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

const alreadyDecided = () =>
  new AppException(
    409,
    'APPEAL_ALREADY_DECIDED',
    'This appeal was already decided',
  );

const targetChanged = (what: 'suspension' | 'take-down') =>
  new AppException(
    409,
    'APPEAL_TARGET_CHANGED',
    `The ${what} this appeal refers to is no longer in effect`,
  );

// Kết quả của một lần quyết định: shop liên quan (để ghi log/báo) và, với kháng nghị sản phẩm, id sản phẩm.
interface DecidedTarget {
  shopId: string;
  productId: string | null;
}

// Hàng đợi và quyết định kháng nghị (Week11.md 4.6 và 5.8, D15), phía ADMIN. Quyền ở controller (JwtAuthGuard + RolesGuard). Hàng đợi chứa
// CẢ HAI loại đối tượng (shop bị khoá, sản phẩm bị gỡ). Chấp nhận kháng nghị shop = mở khoá shop (SUSPENDED → APPROVED) qua đúng luật của
// `AdminService.changeShopStatusInTx` (chủ shop phải còn ACTIVE); chấp nhận kháng nghị sản phẩm = khôi phục sản phẩm về NHÁP qua
// `ProductModerationService.restoreInTx` — TRONG CÙNG transaction với việc đóng kháng nghị: hoặc cả hai thành công hoặc không cái nào. Lời
// kháng nghị và ghi chú là văn bản riêng tư: không vào log (chỉ id), lỗi ghi của Prisma được che bằng redactWriteError.
@Injectable()
export class AdminAppealsService {
  private readonly logger = new Logger(AdminAppealsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminService: AdminService,
    private readonly auditService: AdminAuditService,
    private readonly notificationService: NotificationService,
    private readonly productModeration: ProductModerationService,
  ) {}

  async list(
    query: ListAdminAppealsQueryDto,
  ): Promise<AdminAppealListResponse> {
    const { status, page, limit } = query;
    const filter = filterSql(status);
    const [countRows, idRows] = await Promise.all([
      this.prisma.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT count(*) AS total FROM ${APPEAL_SOURCE_SQL} WHERE ${filter}`,
      ),
      this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT a.id FROM ${APPEAL_SOURCE_SQL} WHERE ${filter} ORDER BY ${orderSql(status)} LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
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

    let target: DecidedTarget;
    try {
      target = await this.prisma.$transaction(async (tx) => {
        // Đua giữa hai Admin có HAI chốt độc lập, mỗi chốt riêng đã đủ (test đua chỉ đỏ khi phá cả hai): `FOR UPDATE` làm người thứ
        // hai chờ rồi thấy status khác PENDING ⇒ 409 mà không làm việc thừa; `UPDATE ... WHERE status = 'PENDING'` bên dưới là
        // lưới cuối nếu khoá bị bỏ — bên thua nhận count = 0 và rollback cả việc mở khoá shop / khôi phục sản phẩm.
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
        if (!appeal) throw notFound();
        if (appeal.status !== 'PENDING') throw alreadyDecided();

        const decided =
          appeal.target_type === 'PRODUCT'
            ? await this.applyProductDecision(
                tx,
                adminId,
                appeal,
                dto,
                auditContext,
              )
            : await this.applyShopDecision(tx, adminId, appeal, dto);

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
        if (count !== 1) throw alreadyDecided();

        // Cùng transaction: quyết định mà không có dấu vết thì không được tồn tại (ghi lỗi ⇒ rollback cả quyết định).
        await this.auditService.record(tx, {
          actorId: adminId,
          action: 'DECIDE_APPEAL',
          targetType: 'APPEAL',
          targetId: appealId,
          ...(dto.note ? { reason: dto.note } : {}),
          meta: {
            decision: dto.decision,
            shopId: decided.shopId,
            ...(decided.productId ? { productId: decided.productId } : {}),
          },
          ...auditContext,
        });
        return decided;
      });
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw redactWriteError(error, 'appeal decision');
    }

    // Chỉ id/quyết định: lời kháng nghị và ghi chú không vào log.
    const verb = dto.decision === 'ACCEPT' ? 'accepted' : 'rejected';
    this.logger.log(
      target.productId
        ? `Admin ${adminId} ${verb} appeal ${appealId} of product ${target.productId} (shop ${target.shopId})`
        : `Admin ${adminId} ${verb} appeal ${appealId} of shop ${target.shopId}`,
    );

    const decision = dto.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
    if (target.productId) {
      // SAU commit, không bao giờ ném: báo chủ shop kết quả. Khôi phục sản phẩm không có thông báo riêng (5.7) — thông báo kết quả này là
      // thông báo duy nhất chủ shop cần.
      await this.notificationService.notify({
        kind: 'PRODUCT_APPEAL_DECIDED',
        appealId,
        productId: target.productId,
        decision,
      });
    } else {
      // Chấp nhận ⇒ thông báo + email "shop được mở khoá" của luồng duyệt shop; rồi báo chủ shop kết quả.
      if (dto.decision === 'ACCEPT') {
        await this.adminService.announceShopStatusChange(
          adminId,
          target.shopId,
          'SUSPENDED',
          { status: 'APPROVED' },
        );
      }
      await this.notificationService.notify({
        kind: 'APPEAL_DECIDED',
        appealId,
        shopId: target.shopId,
        decision,
      });
    }

    const [appeal] = await this.loadByIds([appealId]);
    return { appeal };
  }

  // Kháng nghị shop: kiểm lần khoá còn diễn ra rồi (nếu chấp nhận) mở khoá shop trong CÙNG transaction.
  private async applyShopDecision(
    tx: TxClient,
    adminId: string,
    appeal: { target_id: string; moderation_event_at: Date },
    dto: DecideAppealDto,
  ): Promise<DecidedTarget> {
    const shop = await tx.shop.findUnique({
      where: { id: appeal.target_id },
      select: { status: true, statusChangedAt: true },
    });
    // Lần khoá mà kháng nghị nhắm tới đã kết thúc (shop được mở khoá bằng đường khác, hoặc bị khoá lại một lần khác): không còn
    // gì để chấp nhận hay từ chối.
    if (!shop || !isAppealEpisodeCurrent(shop, appeal.moderation_event_at)) {
      throw targetChanged('suspension');
    }

    if (dto.decision === 'ACCEPT') {
      await this.adminService.changeShopStatusInTx(
        tx,
        adminId,
        appeal.target_id,
        { status: 'APPROVED' },
      );
    }
    return { shopId: appeal.target_id, productId: null };
  }

  // Kháng nghị sản phẩm (Week11.md 5.8): kiểm lần gỡ còn diễn ra rồi (nếu chấp nhận) khôi phục sản phẩm về NHÁP trong CÙNG transaction.
  // `FOR UPDATE` hàng sản phẩm để giữa lúc kiểm và lúc khôi phục không ai khôi phục rồi gỡ lại (đổi sang lần gỡ khác) chen vào; chủ shop
  // gửi kháng nghị cùng lúc (`FOR SHARE`) thì chờ. Từ chối KHÔNG đụng sản phẩm: vẫn bị gỡ, lần gỡ này không kháng nghị lại được.
  private async applyProductDecision(
    tx: TxClient,
    adminId: string,
    appeal: { target_id: string; moderation_event_at: Date },
    dto: DecideAppealDto,
    auditContext: AuditRequestContext,
  ): Promise<DecidedTarget> {
    const rows = await tx.$queryRaw<
      { shop_id: string; status: string; taken_down_at: Date | null }[]
    >(
      Prisma.sql`SELECT shop_id, status, taken_down_at FROM products WHERE id = ${appeal.target_id} FOR UPDATE`,
    );
    const product = rows[0];
    if (
      !product ||
      !isProductAppealEpisodeCurrent(
        { status: product.status, takenDownAt: product.taken_down_at },
        appeal.moderation_event_at,
      )
    ) {
      throw targetChanged('take-down');
    }

    if (dto.decision === 'ACCEPT') {
      // Ghi chú (nếu có) là lý do của dòng nhật ký khôi phục; không có thì dòng đó không có lý do và dòng `DECIDE_APPEAL` giải thích.
      await this.productModeration.restoreInTx(tx, {
        adminId,
        productId: appeal.target_id,
        ...(dto.note ? { reason: dto.note } : {}),
        context: auditContext,
      });
    }
    return { shopId: product.shop_id, productId: appeal.target_id };
  }

  // Đọc kháng nghị theo id, GIỮ thứ tự của `ids`: một truy vấn kháng nghị, một truy vấn sản phẩm (chỉ khi có kháng nghị sản phẩm), một truy
  // vấn shop (kèm chủ shop), một truy vấn tên Admin (chỉ id + name, không email). Đối tượng (hoặc shop của nó) đã bị xoá thì bỏ kháng nghị
  // đó (không có gì để hiển thị).
  private async loadByIds(ids: string[]): Promise<AdminAppeal[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.appeal.findMany({
      where: { id: { in: ids } },
      select: adminAppealSelect,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    const productIds = [
      ...new Set(
        rows.flatMap((row) =>
          row.targetType === 'PRODUCT' ? [row.targetId] : [],
        ),
      ),
    ];
    const products =
      productIds.length === 0
        ? []
        : await this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: appealProductSelect,
          });
    const productById = new Map(
      products.map((product) => [product.id, product]),
    );

    const shopIds = [
      ...new Set(
        rows.flatMap((row) => {
          const shopId =
            row.targetType === 'PRODUCT'
              ? productById.get(row.targetId)?.shopId
              : row.targetId;
          return shopId ? [shopId] : [];
        }),
      ),
    ];
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
      if (!row) continue;
      const product =
        row.targetType === 'PRODUCT'
          ? (productById.get(row.targetId) ?? null)
          : null;
      if (row.targetType === 'PRODUCT' && !product) continue;
      const shop = shopById.get(product ? product.shopId : row.targetId);
      if (!shop) continue;
      items.push(
        toAdminAppeal(
          row,
          shop,
          product,
          row.decidedById ? (adminName.get(row.decidedById) ?? null) : null,
        ),
      );
    }
    return items;
  }
}
