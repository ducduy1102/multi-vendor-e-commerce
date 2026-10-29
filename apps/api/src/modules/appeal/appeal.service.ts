import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  APPEAL_OWNER_HISTORY_LIMIT,
  APPEALABLE_SHOP_STATUS,
  deriveAppealState,
  isAppealEpisodeCurrent,
  type OwnerAppeal,
  type ShopAppealsResponse,
} from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { NotificationService } from '../../shared/notification/notification.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { TxClient } from '../../shared/prisma/tx-client';
import { redactWriteError } from '../../shared/utils/redact-write-error';
import type { CreateAppealDto } from './dto/create-appeal.dto';

// Cột của kháng nghị mà CHỦ SHOP được đọc. Thêm cột vào đây là thêm vào bề mặt lộ dữ liệu: phải kèm trường ở `ownerAppealSchema`
// (packages/types) VÀ ở `toOwnerAppeal` (response dựng bằng object literal tường minh, không spread). KHÔNG có `decidedById`:
// người kháng nghị chỉ biết "sàn" đã quyết, không biết Admin nào.
const ownerAppealSelect = {
  id: true,
  status: true,
  message: true,
  decisionNote: true,
  createdAt: true,
  decidedAt: true,
  moderationEventAt: true,
} satisfies Prisma.AppealSelect;

type OwnerAppealRow = Prisma.AppealGetPayload<{
  select: typeof ownerAppealSelect;
}>;

interface ShopEpisode {
  status: string;
  statusChangedAt: Date;
}

export function toOwnerAppeal(
  row: OwnerAppealRow,
  shop: ShopEpisode,
): OwnerAppeal {
  return {
    id: row.id,
    state: deriveAppealState(
      row.status,
      isAppealEpisodeCurrent(shop, row.moderationEventAt),
    ),
    message: row.message,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    moderationEventAt: row.moderationEventAt.toISOString(),
  };
}

const notAllowed = () =>
  new AppException(
    409,
    'APPEAL_NOT_ALLOWED',
    'This shop cannot be appealed right now',
  );

const alreadySent = () =>
  new AppException(
    409,
    'APPEAL_ALREADY_SENT',
    'An appeal was already sent for this suspension',
  );

// Lỗi vi phạm unique của CHÍNH bảng `Appeal`: soi `meta.modelName` (rules/backend.md mục 4), không so câu chữ lỗi.
function isAppealUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    (error.meta as { modelName?: string } | undefined)?.modelName === 'Appeal'
  );
}

// Kháng nghị của chủ shop (Week11.md 4.6, D15). Chỉ shop ĐANG BỊ KHOÁ (SUSPENDED) bởi một Admin được kháng nghị, và mỗi lần bị khoá
// chỉ MỘT lần. Quyền sở hữu shop do ShopOwnerGuard kiểm TRƯỚC khi tới đây (shop không tồn tại ⇒ 404, không phải chủ ⇒ 403); người
// gửi luôn là người dùng của phiên, shop luôn từ đường dẫn, mốc bị xử lý (`moderationEventAt`) luôn đọc từ `Shop.statusChangedAt` ở
// server — client chỉ gửi lời kháng nghị. Lời kháng nghị là văn bản riêng tư: không có trong log (chỉ id), và lỗi ghi của Prisma
// (mang nguyên giá trị đã ghi) được che bằng redactWriteError.
@Injectable()
export class AppealService {
  private readonly logger = new Logger(AppealService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  // Lịch sử kháng nghị của shop (mới nhất trước) và `canAppeal` — đúng luật của `create`, do server tính để FE không tự suy lại.
  async listForShop(shopId: string): Promise<ShopAppealsResponse> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { status: true, statusChangedAt: true },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    const rows = await this.prisma.appeal.findMany({
      where: { targetType: 'SHOP', targetId: shopId },
      select: ownerAppealSelect,
      orderBy: { moderationEventAt: 'desc' },
      take: APPEAL_OWNER_HISTORY_LIMIT,
    });

    const appealed = rows.some((row) =>
      isAppealEpisodeCurrent(shop, row.moderationEventAt),
    );
    const canAppeal =
      !appealed &&
      shop.status === APPEALABLE_SHOP_STATUS &&
      (await this.isSuspendedByAdmin(this.prisma, shopId));

    return {
      appeals: rows.map((row) => toOwnerAppeal(row, shop)),
      canAppeal,
    };
  }

  async create(
    userId: string,
    shopId: string,
    dto: CreateAppealDto,
  ): Promise<OwnerAppeal> {
    let created: { row: OwnerAppealRow; shop: ShopEpisode };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // `FOR SHARE` giữ hàng shop đến khi giao dịch này commit: một Admin mở khoá shop cùng lúc (UPDATE cần khoá độc quyền) phải
        // chờ, nên kháng nghị không bao giờ gắn vào lần khoá vừa kết thúc. Cùng cách `AdminService.assertOwnerActive`.
        const rows = await tx.$queryRaw<
          { status: string; status_changed_at: Date }[]
        >(
          Prisma.sql`SELECT status, status_changed_at FROM shops WHERE id = ${shopId} FOR SHARE`,
        );
        const locked = rows[0];
        if (!locked) throw new NotFoundException('Shop not found');
        if (
          locked.status !== APPEALABLE_SHOP_STATUS ||
          !(await this.isSuspendedByAdmin(tx, shopId))
        ) {
          throw notAllowed();
        }

        const moderationEventAt = locked.status_changed_at;
        const existing = await tx.appeal.findUnique({
          where: {
            targetType_targetId_moderationEventAt: {
              targetType: 'SHOP',
              targetId: shopId,
              moderationEventAt,
            },
          },
          select: { id: true },
        });
        if (existing) throw alreadySent();

        const row = await tx.appeal.create({
          data: {
            targetType: 'SHOP',
            targetId: shopId,
            appellantId: userId,
            message: dto.message,
            moderationEventAt,
          },
          select: ownerAppealSelect,
        });
        return {
          row,
          shop: { status: locked.status, statusChangedAt: moderationEventAt },
        };
      });
    } catch (error) {
      if (error instanceof AppException || error instanceof NotFoundException) {
        throw error;
      }
      // Hai request đồng thời cùng lần khoá: `@@unique` là trọng tài, bên thua nhận P2002 của chính bảng Appeal.
      if (isAppealUniqueViolation(error)) throw alreadySent();
      throw redactWriteError(error, 'appeal');
    }

    // Chỉ id: lời kháng nghị là văn bản riêng tư, không vào log.
    this.logger.log(
      `Owner ${userId} appealed the suspension of shop ${shopId} (appeal ${created.row.id})`,
    );
    // Báo mọi Admin, SAU commit và không bao giờ ném.
    await this.notificationService.notify({
      kind: 'APPEAL_SUBMITTED',
      appealId: created.row.id,
      shopId,
    });

    return toOwnerAppeal(created.row, created.shop);
  }

  // Lần khoá hiện tại do một ADMIN thực hiện (không phải khoá theo cascade tài khoản): dòng lịch sử mới nhất không do hệ thống ghi.
  // Chủ tài khoản bị khoá không đăng nhập được nên không có đường kháng nghị trong ứng dụng cho trường hợp cascade — họ dùng
  // `SUPPORT_EMAIL` (Week11.md 4.2).
  private async isSuspendedByAdmin(
    client: Pick<TxClient, 'shopStatusHistory'>,
    shopId: string,
  ): Promise<boolean> {
    const latest = await client.shopStatusHistory.findFirst({
      where: { shopId },
      orderBy: { createdAt: 'desc' },
      select: { toStatus: true, actorType: true },
    });
    return (
      latest !== null &&
      latest.toStatus === APPEALABLE_SHOP_STATUS &&
      latest.actorType === 'ADMIN'
    );
  }
}
