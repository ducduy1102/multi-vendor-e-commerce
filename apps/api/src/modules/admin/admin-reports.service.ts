import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  conversationReportSnapshotSchema,
  isReportActionAllowed,
  productReportSnapshotSchema,
  reportStatusForAction,
  reviewReportSnapshotSchema,
  shopReportSnapshotSchema,
  type AdminReport,
  type AdminReportDetailResponse,
  type AdminReportListResponse,
  type ReportConversationReporterRole,
  type ReportResolutionAction,
} from '@ecommerce/types';
import { AdminAuditService } from '../../shared/audit/admin-audit.service';
import type { AuditRequestContext } from '../../shared/audit/audit-request-context';
import { AppException } from '../../shared/exceptions/app.exception';
import { NotificationService } from '../../shared/notification/notification.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { TxClient } from '../../shared/prisma/tx-client';
import { redactWriteError } from '../../shared/utils/redact-write-error';
import { isUuid } from './admin-user-id';
import { AdminUserStatusService } from './admin-user-status.service';
import { AdminService } from './admin.service';
import type { ListAdminReportsQueryDto } from './dto/list-admin-reports-query.dto';
import type { ResolveReportDto } from './dto/resolve-report.dto';
import { ReviewService } from '../review/review.service';

// Cột của báo cáo mà ADMIN được đọc. Thêm cột vào đây là thêm vào bề mặt lộ dữ liệu: phải kèm trường ở `adminReportSchema`
// (packages/types) VÀ ở `toAdminReport` (response dựng bằng object literal tường minh, không spread dữ liệu thô).
const adminReportSelect = {
  id: true,
  targetType: true,
  targetId: true,
  status: true,
  reasonCode: true,
  note: true,
  snapshot: true,
  reporterId: true,
  resolvedById: true,
  resolutionAction: true,
  resolutionNote: true,
  resolvedAt: true,
  createdAt: true,
} satisfies Prisma.ReportSelect;

type AdminReportRow = Prisma.ReportGetPayload<{
  select: typeof adminReportSelect;
}>;

// Người báo như ADMIN thấy: chỉ tên + email (như danh sách kháng nghị), không SĐT hay địa chỉ. Tài khoản đã mất (không xảy ra ở
// môi trường thật — tài khoản không bị xoá) hiện dấu gạch thay vì làm hỏng cả hàng đợi.
const MISSING_ACCOUNT = '—';

export function toAdminReport(
  row: AdminReportRow,
  reporter: { name: string; email: string } | undefined,
  resolvedByName: string | null,
  sameTargetOpenCount: number,
): AdminReport | null {
  const base = {
    id: row.id,
    targetId: row.targetId,
    status: row.status,
    reasonCode: row.reasonCode,
    note: row.note,
    reporter: {
      name: reporter?.name ?? MISSING_ACCOUNT,
      email: reporter?.email ?? MISSING_ACCOUNT,
    },
    createdAt: row.createdAt.toISOString(),
    resolution:
      row.resolvedAt && row.resolutionAction
        ? {
            action: row.resolutionAction,
            note: row.resolutionNote,
            resolvedByName,
            resolvedAt: row.resolvedAt.toISOString(),
          }
        : null,
    sameTargetOpenCount,
  };
  // Ảnh chụp được kiểm lại theo loại khi đọc: hàng hỏng (không thể xảy ra qua đường ghi hợp lệ) trả null để nơi gọi bỏ qua và
  // ghi log, không làm hỏng cả hàng đợi.
  switch (row.targetType) {
    case 'REVIEW': {
      const snapshot = reviewReportSnapshotSchema.safeParse(row.snapshot);
      return snapshot.success
        ? { ...base, targetType: 'REVIEW', snapshot: snapshot.data }
        : null;
    }
    case 'CONVERSATION': {
      const snapshot = conversationReportSnapshotSchema.safeParse(row.snapshot);
      return snapshot.success
        ? { ...base, targetType: 'CONVERSATION', snapshot: snapshot.data }
        : null;
    }
    case 'SHOP': {
      const snapshot = shopReportSnapshotSchema.safeParse(row.snapshot);
      return snapshot.success
        ? { ...base, targetType: 'SHOP', snapshot: snapshot.data }
        : null;
    }
    case 'PRODUCT': {
      const snapshot = productReportSnapshotSchema.safeParse(row.snapshot);
      return snapshot.success
        ? { ...base, targetType: 'PRODUCT', snapshot: snapshot.data }
        : null;
    }
  }
}

const notFound = () =>
  new AppException(404, 'REPORT_NOT_FOUND', 'Report not found');

const alreadyClosed = () =>
  new AppException(
    409,
    'REPORT_ALREADY_CLOSED',
    'This report was already handled',
  );

const actionNotAllowed = (message: string) =>
  new AppException(409, 'REPORT_ACTION_NOT_ALLOWED', message);

// Đối tượng bị báo đã không còn để áp hành động (không xảy ra với shop/hội thoại — chúng không bị xoá — nhưng không để nó thành 500).
const targetGone = () =>
  actionNotAllowed('The reported object no longer exists');

// Ngữ cảnh một hành động xử lý chạy TRONG transaction đóng báo cáo.
interface ReportActionContext {
  tx: TxClient;
  adminId: string;
  auditContext: AuditRequestContext;
  note: string;
  targetId: string;
  // Vai của người báo hội thoại (từ ảnh chụp lúc báo); chỉ có với báo cáo CONVERSATION.
  reporterRole: ReportConversationReporterRole | undefined;
}

// Kết quả của một hành động. `alreadyApplied`: đối tượng đã ở đúng trạng thái bị hạn chế (shop đã bị khoá, tài khoản đã bị khoá/cấm)
// nên không làm lại — báo cáo vẫn được đóng là ĐÃ XỬ LÝ (thực tế các sàn không bắt Admin "bỏ qua" một báo cáo chỉ vì đối tượng đã bị
// phạt từ báo cáo khác). `afterCommit` chạy SAU commit (email, thông báo, ngắt socket của hành động) và không bao giờ làm hỏng request.
interface ReportActionOutcome {
  alreadyApplied: boolean;
  afterCommit?: () => Promise<void>;
}

type ReportActionHandler = (
  context: ReportActionContext,
) => Promise<ReportActionOutcome>;

interface ResolvedInTx {
  closedIds: string[];
  afterCommit?: () => Promise<void>;
}

// Hàng đợi và xử lý báo cáo vi phạm (Week11.md 5.4, D5), phía ADMIN. Quyền ở controller (JwtAuthGuard + RolesGuard). Điều phối ở
// modules/admin (phát hiện 12): gọi lại đúng service sẵn có của từng hành động (khoá shop, khoá tài khoản...) TRONG cùng transaction với
// việc đóng báo cáo — hoặc cả hai thành công hoặc không cái nào.
//
// Xử lý theo ĐỐI TƯỢNG, không theo từng người báo (thực tế các sàn): nhiều người có thể báo cùng một thứ; xử lý MỘT báo cáo thì mọi báo cáo
// ĐANG MỞ còn lại của đối tượng đó đóng luôn cùng hành động và kết quả, hành động theo loại chỉ chạy MỘT lần, nhật ký quản trị ghi MỘT
// dòng, và mỗi người báo nhận đúng một thông báo chung chung. Ghi chú của người báo và của Admin là văn bản riêng tư: không vào log (chỉ
// id), lỗi ghi của Prisma được che bằng redactWriteError.
//
// Các hành động ẩn đánh giá (5.5), gỡ sản phẩm (5.7) và chặn người mua (6.2) cắm vào `handlers` ở bước của chúng; hành động chưa có
// bộ xử lý bị từ chối bằng REPORT_ACTION_NOT_ALLOWED thay vì đóng báo cáo mà không làm gì.
@Injectable()
export class AdminReportsService {
  private readonly logger = new Logger(AdminReportsService.name);

  private readonly handlers: Partial<
    Record<ReportResolutionAction, ReportActionHandler>
  > = {
    HIDE_REVIEW: (context) => this.hideReview(context),
    SUSPEND_SHOP: (context) => this.suspendShop(context),
    SUSPEND_REPORTED_USER: (context) => this.suspendReportedUser(context),
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminService: AdminService,
    private readonly userStatusService: AdminUserStatusService,
    private readonly reviewService: ReviewService,
    private readonly auditService: AdminAuditService,
    private readonly notificationService: NotificationService,
  ) {}

  async list(
    query: ListAdminReportsQueryDto,
  ): Promise<AdminReportListResponse> {
    const { status, targetType, page, limit } = query;
    // Chờ xử lý: cũ nhất trước (không báo cáo nào bị bỏ quên). Đã xử lý: xử lý gần nhất trước. `id` là khoá phụ để phân trang không
    // trùng/mất khi nhiều hàng cùng mili-giây; hai kiểu sắp xếp khớp hai chỉ mục của bảng (không cần Sort).
    const where: Prisma.ReportWhereInput = {
      ...(status === 'OPEN'
        ? { status: 'OPEN' }
        : { resolvedAt: { not: null } }),
      ...(targetType ? { targetType } : {}),
    };
    const orderBy: Prisma.ReportOrderByWithRelationInput[] =
      status === 'OPEN'
        ? [{ createdAt: 'asc' }, { id: 'asc' }]
        : [{ resolvedAt: 'desc' }, { id: 'desc' }];

    const [total, rows] = await Promise.all([
      this.prisma.report.count({ where }),
      this.prisma.report.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: adminReportSelect,
      }),
    ]);
    return { items: await this.present(rows), total, page, limit };
  }

  async detail(reportId: string): Promise<AdminReportDetailResponse> {
    // Id sai dạng (kể cả có NUL mà Postgres không nhận và sẽ thành 500) ra cùng một 404 như id không tồn tại.
    if (!isUuid(reportId)) throw notFound();
    const [report] = await this.loadByIds([reportId]);
    if (!report) throw notFound();
    return { report };
  }

  async resolve(
    adminId: string,
    reportId: string,
    dto: ResolveReportDto,
    auditContext: AuditRequestContext = {},
  ): Promise<AdminReportDetailResponse> {
    if (!isUuid(reportId)) throw notFound();

    let resolved: ResolvedInTx;
    try {
      resolved = await this.prisma.$transaction((tx) =>
        this.resolveInTx(tx, adminId, reportId, dto, auditContext),
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw redactWriteError(error, 'report resolution');
    }

    // Chỉ id và hành động: ghi chú của Admin và của người báo không vào log.
    this.logger.log(
      `Admin ${adminId} resolved report ${reportId} with ${dto.action} (${resolved.closedIds.length} closed)`,
    );

    // SAU commit, không bao giờ ném: hiệu ứng của hành động (email, thông báo cho bên bị xử lý), rồi báo MỖI người báo kết quả chung
    // chung (người nhận, loại đối tượng và kết quả đều đọc lại từ DB).
    await this.runAfterCommit(resolved.afterCommit, reportId);
    await this.notificationService.notify({
      kind: 'REPORTS_RESOLVED',
      reportIds: resolved.closedIds,
    });

    return this.detail(reportId);
  }

  // Toàn bộ phần ghi, MỘT transaction. Hai chốt chặn đua độc lập cho hai Admin xử lý cùng lúc:
  //  1. khoá tư vấn theo ĐỐI TƯỢNG: hai báo cáo khác nhau của cùng một đối tượng được xử lý tuần tự (nếu không, mỗi bên khoá hàng của
  //     mình rồi chờ hàng của bên kia khi đóng báo cáo trùng ⇒ deadlock). Bên đến sau thấy báo cáo của mình đã bị bên trước đóng
  //     ⇒ 409 REPORT_ALREADY_CLOSED mà không làm việc thừa;
  //  2. `SELECT ... FOR UPDATE` hàng báo cáo rồi `UPDATE ... WHERE status = 'OPEN'`: lưới cuối nếu có đường ghi khác bỏ qua khoá tư vấn.
  private async resolveInTx(
    tx: TxClient,
    adminId: string,
    reportId: string,
    dto: ResolveReportDto,
    auditContext: AuditRequestContext,
  ): Promise<ResolvedInTx> {
    const head = await tx.report.findUnique({
      where: { id: reportId },
      select: { targetType: true, targetId: true },
    });
    if (!head) throw notFound();

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`report-target:${head.targetType}:${head.targetId}`}))`;

    const locked = await tx.$queryRaw<{ status: string; snapshot: unknown }[]>(
      Prisma.sql`SELECT status, snapshot FROM reports WHERE id = ${reportId} FOR UPDATE`,
    );
    const report = locked[0];
    if (!report) throw notFound();
    if (report.status !== 'OPEN') throw alreadyClosed();

    const reporterRole =
      head.targetType === 'CONVERSATION'
        ? conversationReportSnapshotSchema.safeParse(report.snapshot).data
            ?.reporterRole
        : undefined;
    // Hành động có dùng được cho loại báo cáo này không — kiểm LẠI ở server, không tin nút bấm ở FE.
    if (!isReportActionAllowed(head.targetType, dto.action, reporterRole)) {
      throw actionNotAllowed('This action does not apply to this report');
    }

    let outcome: ReportActionOutcome = { alreadyApplied: false };
    if (dto.action !== 'DISMISS') {
      const handler = this.handlers[dto.action];
      if (!handler) throw actionNotAllowed('This action is not available yet');
      outcome = await handler({
        tx,
        adminId,
        auditContext,
        // Schema đã bắt buộc ghi chú cho mọi hành động trừ DISMISS.
        note: dto.note ?? '',
        targetId: head.targetId,
        reporterRole,
      });
    }

    // Đóng MỌI báo cáo đang mở của đối tượng này với cùng kết quả (sau hành động, để báo cáo tới trong lúc xử lý cũng được đóng).
    const open = await tx.report.findMany({
      where: {
        targetType: head.targetType,
        targetId: head.targetId,
        status: 'OPEN',
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const closedIds = open.map((row) => row.id);
    if (!closedIds.includes(reportId)) throw alreadyClosed();
    const { count } = await tx.report.updateMany({
      where: { id: { in: closedIds }, status: 'OPEN' },
      data: {
        status: reportStatusForAction(dto.action),
        resolvedById: adminId,
        resolvedAt: new Date(),
        resolutionAction: dto.action,
        resolutionNote: dto.note ?? null,
      },
    });
    // Đã giữ khoá nên bình thường không thể khác; nếu có thì rollback thay vì ghi nhật ký cho việc không xảy ra.
    if (count !== closedIds.length) throw alreadyClosed();

    // Cùng transaction: xử lý mà không có dấu vết thì không được tồn tại (ghi lỗi ⇒ rollback cả hành động).
    await this.auditService.record(tx, {
      actorId: adminId,
      action: 'RESOLVE_REPORT',
      targetType: 'REPORT',
      targetId: reportId,
      ...(dto.note ? { reason: dto.note } : {}),
      meta: {
        action: dto.action,
        targetType: head.targetType,
        targetId: head.targetId,
        closedReports: count,
        alreadyApplied: outcome.alreadyApplied,
      },
      ...auditContext,
    });

    return { closedIds, afterCommit: outcome.afterCommit };
  }

  // Ẩn đánh giá bị báo qua đúng luật ẩn của ReviewService (khoá product → ẩn → tính lại điểm → nhật ký HIDE_REVIEW, cùng transaction với
  // việc đóng báo cáo); tác giả được báo SAU commit. Đã ẩn từ trước ⇒ không ẩn lại, báo cáo vẫn đóng là đã xử lý.
  private async hideReview(
    context: ReportActionContext,
  ): Promise<ReportActionOutcome> {
    const { tx, adminId, auditContext, note, targetId } = context;
    const review = await tx.review.findUnique({
      where: { id: targetId },
      select: { hiddenAt: true },
    });
    if (!review) throw targetGone();
    if (review.hiddenAt) return { alreadyApplied: true };

    await this.reviewService.hideInTx(tx, {
      adminId,
      reviewId: targetId,
      reason: note,
      context: auditContext,
    });
    return {
      alreadyApplied: false,
      afterCommit: () => this.reviewService.announceHidden(targetId),
    };
  }

  // Khoá shop bị báo qua đúng luật của Admin (ShopStatusService: UPDATE ... WHERE status = <cũ>, ghi lịch sử, lý do hiện cho chủ shop).
  private async suspendShop(
    context: ReportActionContext,
  ): Promise<ReportActionOutcome> {
    const { tx, adminId, note, targetId } = context;
    const shop = await tx.shop.findUnique({
      where: { id: targetId },
      select: { status: true },
    });
    if (!shop) throw targetGone();
    if (shop.status === 'SUSPENDED') return { alreadyApplied: true };

    const dto = { status: 'SUSPENDED', reason: note } as const;
    const from = await this.adminService.changeShopStatusInTx(
      tx,
      adminId,
      targetId,
      dto,
    );
    return {
      alreadyApplied: false,
      afterCommit: async () => {
        await this.adminService.announceShopStatusChange(
          adminId,
          targetId,
          from,
          dto,
        );
      },
    };
  }

  // Tạm khoá tài khoản của BÊN BỊ BÁO hội thoại (người mua báo ⇒ chủ shop hiện tại; chủ shop báo ⇒ người mua) qua đúng luật khoá tài
  // khoản (Week11.md 3.3): thu hồi phiên, kéo theo shop, ghi nhật ký SUSPEND_USER. Tài khoản Admin vẫn bị chặn (409) như mọi nơi.
  private async suspendReportedUser(
    context: ReportActionContext,
  ): Promise<ReportActionOutcome> {
    const { tx, adminId, auditContext, note, targetId, reporterRole } = context;
    if (!reporterRole) {
      throw actionNotAllowed('The reported party of this report is unknown');
    }
    const conversation = await tx.conversation.findUnique({
      where: { id: targetId },
      select: { buyerId: true, shop: { select: { ownerId: true } } },
    });
    if (!conversation) throw targetGone();
    const userId =
      reporterRole === 'BUYER'
        ? conversation.shop.ownerId
        : conversation.buyerId;

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { role: true, accountStatus: true },
    });
    if (!user) throw targetGone();
    // Đã bị khoá/cấm rồi thì không làm lại. Admin thì KHÔNG coi là "đã xử lý": để luật khoá tài khoản chặn bằng CANNOT_MODIFY_ADMIN.
    if (user.role !== 'ADMIN' && user.accountStatus !== 'ACTIVE') {
      return { alreadyApplied: true };
    }

    const change = {
      adminId,
      userId,
      to: 'SUSPENDED',
      reason: note,
      context: auditContext,
    } as const;
    const result = await this.userStatusService.changeStatusInTx(tx, change);
    return {
      alreadyApplied: false,
      afterCommit: () =>
        this.userStatusService.announceStatusChange(change, result),
    };
  }

  private async runAfterCommit(
    afterCommit: (() => Promise<void>) | undefined,
    reportId: string,
  ): Promise<void> {
    if (!afterCommit) return;
    try {
      await afterCommit();
    } catch (error) {
      // Báo cáo đã đóng và hành động đã ghi; chỉ hiệu ứng phụ (email/thông báo) lỗi nên không đảo ngược gì.
      this.logger.error(
        `Hiệu ứng sau khi xử lý báo cáo ${reportId} thất bại: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async loadByIds(ids: string[]): Promise<AdminReport[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.report.findMany({
      where: { id: { in: ids } },
      select: adminReportSelect,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return this.present(
      ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      }),
    );
  }

  // Dựng response cho một trang báo cáo, GIỮ thứ tự của `rows`: một truy vấn người báo, một truy vấn tên Admin xử lý (chỉ id + name,
  // không email) và một truy vấn đếm báo cáo mở cùng đối tượng — số truy vấn không phụ thuộc số dòng.
  private async present(rows: AdminReportRow[]): Promise<AdminReport[]> {
    if (rows.length === 0) return [];
    const userIds = [
      ...new Set(
        rows.flatMap((row) =>
          row.resolvedById
            ? [row.reporterId, row.resolvedById]
            : [row.reporterId],
        ),
      ),
    ];
    const pairs = [
      ...new Map(
        rows.map((row) => [
          `${row.targetType}:${row.targetId}`,
          { targetType: row.targetType, targetId: row.targetId },
        ]),
      ).values(),
    ];
    const [users, counts] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.report.groupBy({
        by: ['targetType', 'targetId'],
        where: { status: 'OPEN', OR: pairs },
        _count: { _all: true },
      }),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const openByTarget = new Map(
      counts.map((group) => [
        `${group.targetType}:${group.targetId}`,
        group._count._all,
      ]),
    );

    const items: AdminReport[] = [];
    for (const row of rows) {
      const open = openByTarget.get(`${row.targetType}:${row.targetId}`) ?? 0;
      const item = toAdminReport(
        row,
        userById.get(row.reporterId),
        row.resolvedById
          ? (userById.get(row.resolvedById)?.name ?? null)
          : null,
        // Không tính chính nó khi nó cũng đang mở.
        Math.max(0, open - (row.status === 'OPEN' ? 1 : 0)),
      );
      if (item) items.push(item);
      else this.logger.error(`Report ${row.id} has an invalid snapshot`);
    }
    return items;
  }
}
