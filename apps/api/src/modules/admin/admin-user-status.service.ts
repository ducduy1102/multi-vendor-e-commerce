import { Inject, Injectable, Logger } from '@nestjs/common';
import { AccountStatus, Role, type UserLocale } from '@prisma/client';
import {
  canTransitionAccountStatus,
  type AccountStatus as SharedAccountStatus,
  type AdminUser,
  type AdminUserSuspendTarget,
} from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { AdminAuditService } from '../../shared/audit/admin-audit.service';
import type { AuditRequestContext } from '../../shared/audit/audit-request-context';
import { frontendUrl } from '../../shared/mail/frontend-url';
import { MailService } from '../../shared/mail/mail.service';
import { getSupportEmail } from '../../shared/mail/support-email';
import type {
  AccountStatusEmailKind,
  AccountStatusShopNotice,
} from '../../shared/mail/templates/account-email.types';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { TxClient } from '../../shared/prisma/tx-client';
import {
  REALTIME_EMITTER,
  type RealtimeEmitter,
} from '../../shared/realtime/realtime-emitter';
import { isUserId } from './admin-user-id';
import { AdminUserShopCascadeService } from './admin-user-shop-cascade.service';
import { adminUserSelect, toAdminUser } from './admin-user.service';

// Người nhận email trạng thái tài khoản: chính chủ. Đọc cùng lượt với việc kiểm trạng thái, trong transaction.
export interface Recipient {
  email: string;
  name: string;
  locale: UserLocale;
}

// Kết quả kéo theo shop: số liệu cho nhật ký quản trị và câu nói thêm về shop trong email.
interface ShopEffect {
  meta: Record<string, number>;
  notice: AccountStatusShopNotice | null;
}

// Một lần đổi trạng thái tài khoản: ai (Admin) đổi tài khoản nào sang trạng thái nào, vì sao, từ request nào.
export interface StatusChange {
  adminId: string;
  userId: string;
  to: SharedAccountStatus;
  reason: string;
  context: AuditRequestContext;
}

// Kết quả của phần TRONG transaction, chuyển sang phần SAU commit (`announceStatusChange`) để gửi email / ngắt socket đúng với
// những gì đã ghi.
export interface StatusChangeResult {
  user: AdminUser;
  from: SharedAccountStatus;
  recipient: Recipient;
  shopNotice: AccountStatusShopNotice | null;
}

// Khoá / cấm / mở lại tài khoản người dùng (Week11.md 3.3, D2). Quy tắc xuyên suốt:
//  - MỘT `$transaction` cho mọi thứ làm thay đổi dữ liệu: kiểm điều kiện, UPDATE có điều kiện, thu hồi phiên, dòng nhật ký
//    quản trị. Nhật ký ghi CÙNG transaction (rules ở AdminAuditService): ghi lỗi ⇒ rollback ⇒ tài khoản không bị khoá mà
//    không có dấu vết. Cascade shop (3.4) cũng nằm trong ĐÚNG transaction này: tài khoản bị khoá mà shop không bị khoá (hoặc
//    ngược lại) không thể xảy ra, kể cả khi một trong hai bước lỗi giữa chừng.
//  - side-effect (ngắt socket, email) chạy SAU commit và KHÔNG BAO GIỜ làm hỏng request: DB đã xong việc của nó
//    (rules/backend.md mục 4). Log chỉ có id, không bao giờ lý do (văn bản Admin tự nhập) hay email.
@Injectable()
export class AdminUserStatusService {
  private readonly logger = new Logger(AdminUserStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AdminAuditService,
    private readonly mailService: MailService,
    @Inject(REALTIME_EMITTER) private readonly realtime: RealtimeEmitter,
    private readonly shopCascade: AdminUserShopCascadeService,
  ) {}

  suspend(
    adminId: string,
    userId: string,
    input: { status: AdminUserSuspendTarget; reason: string },
    context: AuditRequestContext = {},
  ): Promise<AdminUser> {
    return this.changeStatus({
      adminId,
      userId,
      to: input.status,
      reason: input.reason,
      context,
    });
  }

  reactivate(
    adminId: string,
    userId: string,
    input: { reason: string },
    context: AuditRequestContext = {},
  ): Promise<AdminUser> {
    return this.changeStatus({
      adminId,
      userId,
      to: 'ACTIVE',
      reason: input.reason,
      context,
    });
  }

  private async changeStatus(change: StatusChange): Promise<AdminUser> {
    // Id sai dạng ⇒ 404 như id không tồn tại, TRƯỚC khi mở transaction (ký tự NUL trong id làm Postgres báo lỗi ⇒ 500).
    if (!isUserId(change.userId)) {
      throw new AppException(404, 'USER_NOT_FOUND', 'User not found');
    }

    const result = await this.prisma.$transaction((tx) =>
      this.changeStatusInTx(tx, change),
    );
    await this.announceStatusChange(change, result);
    return result.user;
  }

  // Phần TRONG transaction của việc đổi trạng thái tài khoản: kiểm điều kiện, UPDATE có điều kiện, thu hồi phiên, kéo theo shop và
  // dòng nhật ký quản trị. PUBLIC để xử lý báo cáo (AdminReportsService, Week11.md 5.4) khoá chủ thể bị báo trong CÙNG transaction
  // với việc đóng báo cáo mà không nhân đôi luật này. Người gọi PHẢI kiểm `userId` là UUID trước, và PHẢI gọi
  // `announceStatusChange` SAU khi transaction commit.
  async changeStatusInTx(
    tx: TxClient,
    change: StatusChange,
  ): Promise<StatusChangeResult> {
    const { adminId, userId, to, reason, context } = change;

    const current = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        email: true,
        name: true,
        locale: true,
        // Mốc tài khoản vào trạng thái hiện tại: cần để biết shop nào bị khoá bởi CHÍNH lần khoá này (mở lại từ tạm khoá).
        statusChangedAt: true,
      },
    });
    if (!current) {
      throw new AppException(404, 'USER_NOT_FOUND', 'User not found');
    }
    // Tự khoá mình trước, rồi mới tới "là Admin": Admin tự nhắm vào chính mình cũng là Admin nên nếu kiểm vai trước thì
    // lúc nào cũng ra CANNOT_MODIFY_ADMIN và FE không phân biệt được hai ca.
    if (current.id === adminId) {
      throw new AppException(
        409,
        'CANNOT_MODIFY_SELF',
        'Admins cannot change their own account status',
      );
    }
    if (current.role === Role.ADMIN) {
      throw new AppException(
        409,
        'CANNOT_MODIFY_ADMIN',
        'Admin accounts cannot be suspended or banned',
      );
    }
    const from = current.accountStatus;
    if (!canTransitionAccountStatus(from, to)) {
      throw invalidTransition(from, to);
    }

    // UPDATE có điều kiện theo trạng thái ĐÃ ĐỌC (và vai USER, phòng một ngày nào đó có đường đổi vai): hai Admin cùng
    // bấm thì Postgres chạy lần lượt, người thứ hai thấy trạng thái đã đổi nên count = 0 ⇒ 409, không ghi đè lý do /
    // mốc của người thứ nhất. KHÔNG đọc-rồi-ghi tách rời (rules/backend.md mục 4).
    const locking = to !== AccountStatus.ACTIVE;
    const { count } = await tx.user.updateMany({
      where: { id: userId, role: Role.USER, accountStatus: from },
      data: {
        accountStatus: to,
        // Lý do chỉ nằm ở cột khi đang bị khoá; mở lại ⇒ NULL (lý do mở lại nằm ở nhật ký và email).
        statusReason: locking ? reason : null,
        statusChangedAt: new Date(),
        // Khoá / cấm thu hồi phiên: refresh token cũ chết ngay. Access token cũ (≤ ~15 phút) cũng vô dụng vì
        // JwtStrategy đọc lại accountStatus ở MỌI request ⇒ 401 ACCOUNT_NOT_ACTIVE.
        ...(locking ? { refreshTokenHash: null } : {}),
      },
    });
    if (count === 0) throw invalidTransition(from, to);

    // Kéo theo shop SAU khi UPDATE user (không đổi thứ tự): việc duyệt shop của AdminService giữ khoá chia sẻ trên hàng user
    // đến khi commit, nên UPDATE user ở trên chờ nó xong và truy vấn shop APPROVED ở đây thấy cả shop vừa được duyệt.
    const shopEffect = await this.cascadeToShops(
      tx,
      userId,
      from,
      to,
      current.statusChangedAt,
    );

    await this.auditService.record(tx, {
      actorId: adminId,
      action: locking ? 'SUSPEND_USER' : 'REACTIVATE_USER',
      targetType: 'USER',
      targetId: userId,
      reason,
      // Số shop bị kéo theo (số nguyên — meta của nhật ký không nhận chuỗi tự do).
      meta: { from, to, ...shopEffect.meta },
      ...context,
    });

    const row = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: adminUserSelect,
    });
    return {
      user: toAdminUser(row),
      from,
      recipient: {
        email: current.email,
        name: current.name,
        locale: current.locale,
      },
      shopNotice: shopEffect.notice,
    };
  }

  // Phần SAU commit: log, ngắt socket (khi khoá) và email báo chủ tài khoản. KHÔNG BAO GIỜ ném (DB đã xong việc của nó,
  // rules/backend.md mục 4). Log chỉ có id và hướng đổi; lý do là văn bản Admin tự nhập nên không vào log.
  async announceStatusChange(
    change: StatusChange,
    result: StatusChangeResult,
  ): Promise<void> {
    const { adminId, userId, to, reason } = change;
    this.logger.log(
      `Admin ${adminId} changed user ${userId} account status ${result.from} -> ${to}`,
    );

    if (to !== AccountStatus.ACTIVE) {
      await this.disconnectSafely(userId);
    }
    await this.notifySafely(
      userId,
      to,
      reason,
      result.recipient,
      result.shopNotice,
    );
  }

  // Shop của chủ tài khoản theo hướng đổi (Week11.md 3.4, D2):
  //  - khoá / cấm: mọi shop APPROVED ⇒ SUSPENDED (actor SYSTEM);
  //  - mở lại từ TẠM KHOÁ: mở lại đúng shop do chính lần khoá này khoá;
  //  - mở lại từ BỊ CẤM: KHÔNG tự mở shop nào (cấm là mức nặng, mở lại phải xét lại) — chỉ đếm để email báo trước.
  private async cascadeToShops(
    tx: TxClient,
    userId: string,
    from: SharedAccountStatus,
    to: SharedAccountStatus,
    lockStartedAt: Date | null,
  ): Promise<ShopEffect> {
    if (to !== AccountStatus.ACTIVE) {
      const suspended = await this.shopCascade.suspendOwnedShops(tx, userId);
      return {
        meta: { shopsSuspended: suspended },
        notice: suspended > 0 ? 'SUSPENDED' : null,
      };
    }
    if (from === AccountStatus.SUSPENDED) {
      const reopened = await this.shopCascade.reopenCascadeSuspendedShops(
        tx,
        userId,
        lockStartedAt,
      );
      return {
        meta: { shopsReopened: reopened },
        notice: reopened > 0 ? 'REOPENED' : null,
      };
    }
    const stillSuspended = await this.shopCascade.countSuspendedShops(
      tx,
      userId,
    );
    return {
      meta: { shopsStillSuspended: stillSuspended },
      notice: stillSuspended > 0 ? 'STILL_SUSPENDED' : null,
    };
  }

  // Ngắt MỌI socket đang mở của người bị khoá (sự kiện chat / thông báo không được tiếp tục chảy tới họ). Chỉ ngắt kết nối
  // ĐANG mở; chặn nối lại là việc của handshake (đọc lại accountStatus từ DB). Không bao giờ ném.
  private async disconnectSafely(userId: string): Promise<void> {
    try {
      await this.realtime.disconnectUser(userId);
    } catch (error) {
      this.logger.error(
        `Ngắt kết nối real-time thất bại cho user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Báo chính chủ theo `User.locale`. Lỗi gửi thư chỉ log (id + thông điệp lỗi, KHÔNG kèm lý do hay địa chỉ email), không
  // đảo ngược việc đã làm. Không bao giờ ném.
  private async notifySafely(
    userId: string,
    to: SharedAccountStatus,
    reason: string,
    recipient: Recipient,
    shopNotice: AccountStatusShopNotice | null,
  ): Promise<void> {
    const kind: AccountStatusEmailKind =
      to === 'ACTIVE'
        ? 'REACTIVATED'
        : to === 'BANNED'
          ? 'BANNED'
          : 'SUSPENDED';
    try {
      await this.mailService.sendAccountStatusChanged(recipient.email, {
        locale: recipient.locale,
        name: recipient.name,
        kind,
        reason,
        supportEmail: getSupportEmail(),
        loginUrl: frontendUrl('/login', recipient.locale),
        shopNotice,
      });
    } catch (error) {
      this.logger.error(
        `Gửi email trạng thái tài khoản thất bại cho user ${userId} (${kind}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function invalidTransition(
  from: SharedAccountStatus,
  to: SharedAccountStatus,
): AppException<'USER_INVALID_TRANSITION'> {
  return new AppException(
    409,
    'USER_INVALID_TRANSITION',
    `Cannot change account status from ${from} to ${to}`,
  );
}
