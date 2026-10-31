import { HttpException, Injectable } from '@nestjs/common';
import type { ProductModerationResponse } from '@ecommerce/types';
import { AdminAuditService } from '../../shared/audit/admin-audit.service';
import type { AuditRequestContext } from '../../shared/audit/audit-request-context';
import { AppException } from '../../shared/exceptions/app.exception';
import { NotificationService } from '../../shared/notification/notification.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { TxClient } from '../../shared/prisma/tx-client';
import { redactWriteError } from '../../shared/utils/redact-write-error';

export interface ProductModerationInput {
  adminId: string;
  productId: string;
  // Văn bản Admin nhập, đã qua schema dùng chung (1..500 ký tự, đã chuẩn hoá).
  reason: string;
  context: AuditRequestContext;
}

const productNotFound = () =>
  new AppException(404, 'PRODUCT_NOT_FOUND', 'Product not found');

const alreadyTakenDown = () =>
  new AppException(
    409,
    'PRODUCT_ALREADY_TAKEN_DOWN',
    'This product is already taken down',
  );

const notTakenDown = () =>
  new AppException(
    409,
    'PRODUCT_NOT_TAKEN_DOWN',
    'This product is not taken down',
  );

// Gỡ / khôi phục sản phẩm vi phạm (Week11.md 5.7, D5), phía ADMIN. Quyền ở controller (JwtAuthGuard + RolesGuard) hoặc ở xử lý báo cáo
// (modules/admin điều phối và gọi `takeDownInTx` TRONG cùng transaction với việc đóng báo cáo — hoặc cả hai thành công hoặc không cái
// nào). Chủ shop KHÔNG có đường nào vào đây: ProductService chặn mọi thao tác của họ lên sản phẩm đang bị gỡ (409 PRODUCT_TAKEN_DOWN).
//
// Cả hai chiều đổi trạng thái là UPDATE có điều kiện (`status <> 'TAKEN_DOWN'` / `status = 'TAKEN_DOWN'`): hai Admin cùng gỡ thì đúng một
// bên thắng, bên kia nhận 409 — không ghi hai lần, không hai dòng nhật ký, không hai thông báo. Nhật ký quản trị ghi CÙNG transaction
// (lỗi ghi ⇒ rollback cả thay đổi); thông báo cho chủ shop chạy SAU commit và không bao giờ ném.
//
// Gỡ không đụng tới dữ liệu khác: `OrderItem` là ảnh chụp nên đơn đã đặt vẫn xem được; giữ chỗ tồn kho của nhóm chưa thanh toán tự nhả bằng
// job hiện có; giỏ hàng / wishlist tự đánh dấu "không còn bán" vì chỉ PUBLISHED mới là còn bán.
@Injectable()
export class ProductModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AdminAuditService,
    private readonly notificationService: NotificationService,
  ) {}

  // Phần TRONG transaction (public để xử lý báo cáo gọi chung transaction). Người gọi PHẢI gọi `announceTakenDown` SAU commit.
  async takeDownInTx(
    tx: TxClient,
    input: ProductModerationInput,
  ): Promise<{ takenDownAt: Date }> {
    const { adminId, productId, reason, context } = input;
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { shopId: true },
    });
    if (!product) throw productNotFound();

    const takenDownAt = new Date();
    const { count } = await tx.product.updateMany({
      where: { id: productId, status: { not: 'TAKEN_DOWN' } },
      data: {
        status: 'TAKEN_DOWN',
        takenDownAt,
        takenDownById: adminId,
        takenDownReason: reason,
      },
    });
    if (count === 0) throw alreadyTakenDown();

    await this.auditService.record(tx, {
      actorId: adminId,
      action: 'TAKE_DOWN_PRODUCT',
      targetType: 'PRODUCT',
      targetId: productId,
      reason,
      meta: { shopId: product.shopId },
      ...context,
    });
    return { takenDownAt };
  }

  // Khôi phục: chỉ từ TAKEN_DOWN, về NHÁP (chủ shop tự sửa rồi xuất bản lại — không tự bán lại nội dung từng vi phạm). Xoá cả ba cột gỡ;
  // lịch sử gỡ / khôi phục nằm ở nhật ký quản trị.
  async restoreInTx(
    tx: TxClient,
    input: ProductModerationInput,
  ): Promise<void> {
    const { adminId, productId, reason, context } = input;
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { shopId: true },
    });
    if (!product) throw productNotFound();

    const { count } = await tx.product.updateMany({
      where: { id: productId, status: 'TAKEN_DOWN' },
      data: {
        status: 'DRAFT',
        takenDownAt: null,
        takenDownById: null,
        takenDownReason: null,
      },
    });
    if (count === 0) throw notTakenDown();

    await this.auditService.record(tx, {
      actorId: adminId,
      action: 'RESTORE_PRODUCT',
      targetType: 'PRODUCT',
      targetId: productId,
      reason,
      meta: { shopId: product.shopId },
      ...context,
    });
  }

  // Báo chủ shop SAU commit, không bao giờ ném (NotificationService.notify). Người nhận và tên sản phẩm suy từ DB; chỉ `reason` do nơi
  // gọi truyền (đúng lý do đã ghi).
  async announceTakenDown(productId: string, reason: string): Promise<void> {
    await this.notificationService.notify({
      kind: 'PRODUCT_TAKEN_DOWN',
      productId,
      reason,
    });
  }

  // POST /admin/products/:id/take-down. Lý do là văn bản Admin nhập: lỗi ghi của Prisma (mang nguyên giá trị đã ghi) được che bằng
  // redactWriteError trước khi tới bộ lọc lỗi.
  async takeDown(
    input: ProductModerationInput,
  ): Promise<ProductModerationResponse> {
    let takenDownAt: Date;
    try {
      ({ takenDownAt } = await this.prisma.$transaction((tx) =>
        this.takeDownInTx(tx, input),
      ));
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw redactWriteError(error, 'product moderation');
    }
    await this.announceTakenDown(input.productId, input.reason);
    return {
      product: {
        id: input.productId,
        status: 'TAKEN_DOWN',
        takenDownAt: takenDownAt.toISOString(),
      },
    };
  }

  async restore(
    input: ProductModerationInput,
  ): Promise<ProductModerationResponse> {
    try {
      await this.prisma.$transaction((tx) => this.restoreInTx(tx, input));
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw redactWriteError(error, 'product moderation');
    }
    return {
      product: { id: input.productId, status: 'DRAFT', takenDownAt: null },
    };
  }
}
