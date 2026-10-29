import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type ShopStatus } from '@prisma/client';
import { canActorTransitionShop } from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { frontendUrl } from '../../shared/mail/frontend-url';
import type { MailLocale } from '../../shared/mail/mail-locale';
import { MailService } from '../../shared/mail/mail.service';
import { getSupportEmail } from '../../shared/mail/support-email';
import { NotificationService } from '../../shared/notification/notification.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { TxClient } from '../../shared/prisma/tx-client';
import { ShopStatusService } from '../shop/shop-status.service';
import type { ListShopsQueryDto } from './dto/list-shops-query.dto';
import type { UpdateShopStatusDto } from './dto/update-shop-status.dto';
import {
  shopStatusEmailKind,
  shopStatusEmailPath,
  shopStatusEmailReason,
} from './shop-status-email';

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

// Người nhận email trạng thái shop: chủ shop. Truy vấn riêng và hẹp (không nhét `locale` vào
// adminShopSelect) để không đổi hình dạng response của Admin.
const shopStatusRecipientSelect = {
  name: true,
  owner: { select: { name: true, email: true, locale: true } },
} satisfies Prisma.ShopSelect;

type ShopStatusRecipient = Prisma.ShopGetPayload<{
  select: typeof shopStatusRecipientSelect;
}>;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopStatusService: ShopStatusService,
    private readonly mailService: MailService,
    private readonly notificationService: NotificationService,
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
    const from = await this.prisma.$transaction((tx) =>
      this.changeShopStatusInTx(tx, adminId, shopId, dto),
    );
    return this.announceShopStatusChange(adminId, shopId, from, dto);
  }

  // Phần TRONG transaction của việc Admin đổi trạng thái shop: đọc shop, kiểm chủ shop còn ACTIVE khi duyệt/mở khoá, rồi giao cho
  // ShopStatusService. Trả trạng thái CŨ. PUBLIC để quyết định kháng nghị (AdminAppealsService, Week11.md 4.6) chấp nhận
  // SUSPENDED → APPROVED trong CÙNG transaction với việc đóng kháng nghị mà không nhân đôi luật này.
  async changeShopStatusInTx(
    tx: TxClient,
    adminId: string,
    shopId: string,
    dto: UpdateShopStatusDto,
  ): Promise<ShopStatus> {
    const current = await tx.shop.findUnique({
      where: { id: shopId },
      select: { status: true, ownerId: true },
    });
    if (!current) {
      throw new NotFoundException('Shop not found');
    }
    // Duyệt (PENDING → APPROVED) và mở khoá (SUSPENDED → APPROVED) cho shop nhận đơn trở lại, nên chủ shop phải đang
    // ACTIVE (Week11.md 3.4). Chỉ kiểm khi đây là một cạnh hợp lệ của Admin: cạnh sai vẫn ra SHOP_INVALID_TRANSITION chứ
    // không bị che bởi lỗi chủ shop. Từ chối (REJECTED) và khoá (SUSPENDED) không bị chặn.
    if (
      dto.status === 'APPROVED' &&
      canActorTransitionShop('ADMIN', current.status, 'APPROVED')
    ) {
      await this.assertOwnerActive(tx, current.ownerId);
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
  }

  // Phần SAU commit: nhật ký, thông báo trong ứng dụng, email cho chủ shop và response của Admin. Không bao giờ chạy trong
  // $transaction (gọi dịch vụ ngoài trong transaction giữ khoá lâu, mail lỗi sẽ rollback cả việc đổi trạng thái); không bao giờ ném
  // vì thông báo/email.
  async announceShopStatusChange(
    adminId: string,
    shopId: string,
    from: ShopStatus,
    dto: UpdateShopStatusDto,
  ): Promise<AdminShopSummary> {
    // Lý do là văn bản Admin tự nhập — không đưa vào log, chỉ ai/shop nào/đổi từ đâu sang đâu.
    this.logger.log(
      `Admin ${adminId} changed shop ${shopId} status ${from} -> ${dto.status}`,
    );

    // Báo chủ shop trong ứng dụng (mọi cạnh Admin vừa làm), SAU commit và không bao giờ ném. Lý do chỉ đi vào thông
    // báo (đã cắt gọn), không vào log.
    await this.notificationService.notify({
      kind: 'SHOP_STATUS_CHANGED',
      shopId,
      status: dto.status,
      reason: dto.reason,
    });

    const [shop, recipient] = await Promise.all([
      this.prisma.shop.findUniqueOrThrow({
        where: { id: shopId },
        select: adminShopSelect,
      }),
      this.prisma.shop.findUnique({
        where: { id: shopId },
        select: shopStatusRecipientSelect,
      }),
    ]);

    // SAU khi transaction đã commit (không bao giờ trong $transaction — gọi dịch vụ ngoài trong transaction
    // giữ khoá lâu và mail lỗi sẽ rollback cả việc duyệt). Không bao giờ ném.
    await this.notifyOwnerSafely(shopId, from, dto, recipient);

    return toAdminShop(shop);
  }

  // `FOR SHARE` trên hàng user: giữ khoá chia sẻ đến khi transaction duyệt commit. Việc khoá tài khoản (AdminUserStatusService)
  // UPDATE hàng user — cần khoá độc quyền — nên nó PHẢI chờ lần duyệt này xong, rồi mới quét "shop APPROVED của chủ" để khoá
  // theo; thiếu khoá này, một lần duyệt chạy song song với một lần khoá tài khoản có thể để lại shop APPROVED của chủ đã bị
  // khoá (lần quét của việc khoá không thấy shop còn PENDING chưa commit). Ngược lại nếu việc khoá commit trước, đọc ở đây
  // thấy trạng thái mới và trả 409. Chủ shop không còn (đã xoá) cũng coi là không ACTIVE.
  private async assertOwnerActive(
    tx: TxClient,
    ownerId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ account_status: string }[]>(
      Prisma.sql`SELECT account_status FROM users WHERE id = ${ownerId} FOR SHARE`,
    );
    if (rows[0]?.account_status !== 'ACTIVE') {
      throw new AppException(
        409,
        'SHOP_OWNER_NOT_ACTIVE',
        'The shop owner account is not active',
      );
    }
  }

  // Báo chủ shop kết quả Admin vừa xử lý (Week9.md 1.13), theo `User.locale` của họ. Chỉ 4 cạnh của Admin
  // có mail (shopStatusEmailKind); `resubmit` của chủ shop đi qua ShopStatusService trực tiếp, không qua đây.
  // Cùng nguyên tắc rules/backend.md mục 4: DB đã xong việc của nó, mail lỗi chỉ được log (kèm shopId,
  // KHÔNG kèm lý do do Admin nhập) chứ không làm fail request và không đảo ngược trạng thái đã đổi.
  private async notifyOwnerSafely(
    shopId: string,
    from: ShopStatus,
    dto: UpdateShopStatusDto,
    recipient: ShopStatusRecipient | null,
  ): Promise<void> {
    const kind = shopStatusEmailKind(from, dto.status);
    if (!kind || !recipient?.owner) return;

    const locale: MailLocale = recipient.owner.locale;
    try {
      await this.mailService.sendShopStatusChanged(recipient.owner.email, {
        locale,
        ownerName: recipient.owner.name,
        shopName: recipient.name,
        kind,
        reason: shopStatusEmailReason(kind, dto.reason),
        shopUrl: frontendUrl(shopStatusEmailPath(kind), locale),
        supportEmail: getSupportEmail(),
      });
    } catch (error) {
      this.logger.error(
        `Gửi email trạng thái shop ${shopId} (${kind}) thất bại: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
