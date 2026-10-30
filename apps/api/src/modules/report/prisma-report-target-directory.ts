import { Injectable } from '@nestjs/common';
import {
  clipNotificationLabel,
  REPORT_SNAPSHOT_MAX_BYTES,
  REPORT_SNAPSHOT_NAME_MAX_LENGTH,
  type ReportConversationReporterRole,
  type ReportTargetType,
  type ReviewReportSnapshot,
} from '@ecommerce/types';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  ReportTargetDirectory,
  ResolvedReportTarget,
} from './report-target-directory';

// Tên đưa vào ảnh chụp: một dòng, bỏ ký tự lạ, cắt về độ dài tối đa của ảnh chụp. Tên hợp lệ không bao giờ rỗng nhưng nếu dữ liệu
// hỏng khiến nó rỗng thì dùng dấu gạch thay vì để ảnh chụp bị từ chối (người báo sẽ nhận 500 chỉ vì tên của người khác).
const NAME_FALLBACK = '—';
const snapshotName = (value: string): string =>
  clipNotificationLabel(value, REPORT_SNAPSHOT_NAME_MAX_LENGTH) ||
  NAME_FALLBACK;

const byteLength = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), 'utf8');

// Đánh giá được lưu NGUYÊN VĂN (bằng chứng, vì tác giả sửa được một lần sau khi bị báo) nhưng phần duy nhất không có cận byte thật
// sự là `comment`: 1.000 đơn vị ký tự điều khiển hợp lệ với schema đánh giá (chỉ cắt khoảng trắng) mà JSON hoá thành `\u0001` = 6
// byte mỗi ký tự ⇒ vượt trần ảnh chụp. Cắt bớt `comment` (kèm "…") cho tới khi vừa, không bao giờ cắt đôi một cặp thay thế UTF-16.
function fitReviewSnapshot(
  snapshot: ReviewReportSnapshot,
): ReviewReportSnapshot {
  let current = snapshot;
  while (
    current.comment !== null &&
    byteLength(current) > REPORT_SNAPSHOT_MAX_BYTES
  ) {
    let cut = current.comment.slice(
      0,
      Math.floor(current.comment.length * 0.8),
    );
    const last = cut.charCodeAt(cut.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
    current = { ...current, comment: cut === '' ? null : `${cut}…` };
  }
  return current;
}

// Bản cài đặt ReportTargetDirectory dùng Prisma. Mỗi `select` chỉ lấy những cột cần cho quyết định "người báo có thấy được đối tượng
// không / có phải của họ không" và cho ảnh chụp — KHÔNG email, SĐT, địa chỉ hay (với hội thoại) bất kỳ nội dung tin nhắn nào.
@Injectable()
export class PrismaReportTargetDirectory implements ReportTargetDirectory {
  constructor(private readonly prisma: PrismaService) {}

  resolve(
    reporterId: string,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<ResolvedReportTarget | null> {
    switch (targetType) {
      case 'REVIEW':
        return this.review(reporterId, targetId);
      case 'CONVERSATION':
        return this.conversation(reporterId, targetId);
      case 'SHOP':
        return this.shop(reporterId, targetId);
      case 'PRODUCT':
        return this.product(reporterId, targetId);
      default: {
        // Thêm loại đối tượng mà quên xử lý ở đây là LỖI BIÊN DỊCH (never).
        const unhandled: never = targetType;
        throw new Error(`Unhandled report target type ${String(unhandled)}`);
      }
    }
  }

  // Đánh giá thấy được với mọi người khi sản phẩm đang bán công khai; chủ shop của sản phẩm thấy được cả khi sản phẩm không còn công
  // khai (đánh giá nằm trong sản phẩm của họ) nên báo được đánh giá bậy bạ trên hàng của mình. Tác giả không tự báo đánh giá của mình.
  private async review(
    reporterId: string,
    reviewId: string,
  ): Promise<ResolvedReportTarget | null> {
    const row = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: {
        userId: true,
        rating: true,
        comment: true,
        user: { select: { name: true } },
        product: {
          select: {
            id: true,
            name: true,
            status: true,
            shop: { select: { ownerId: true, status: true } },
          },
        },
      },
    });
    if (!row) return null;

    const isPublic =
      row.product.status === 'PUBLISHED' &&
      row.product.shop.status === 'APPROVED';
    if (!isPublic && row.product.shop.ownerId !== reporterId) return null;

    return {
      ownedByReporter: row.userId === reporterId,
      snapshot: fitReviewSnapshot({
        productId: row.product.id,
        productName: snapshotName(row.product.name),
        rating: row.rating,
        comment: row.comment,
        authorName: snapshotName(row.user.name),
      }),
    };
  }

  // Chỉ hai thành viên báo được hội thoại; người ngoài, hội thoại không tồn tại và hội thoại chưa có tin nào (không hiện ở cả hai
  // phía) đều ra `null`. Shop đã bị khoá vẫn báo được: hội thoại chỉ-đọc nhưng người mua có thể muốn báo lời lẽ trước khi bị khoá.
  // KHÔNG đọc nội dung tin — ảnh chụp chỉ có tên hai bên và vai người báo.
  private async conversation(
    reporterId: string,
    conversationId: string,
  ): Promise<ResolvedReportTarget | null> {
    const row = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        buyerId: true,
        lastMessageAt: true,
        buyer: { select: { name: true } },
        shop: { select: { ownerId: true, name: true } },
      },
    });
    if (!row || row.lastMessageAt === null) return null;

    // Người mua được xét TRƯỚC: nếu vì lý do nào đó một người vừa là người mua vừa là chủ shop của hội thoại thì họ được coi là
    // người mua (vai còn lại sẽ làm `BLOCK_BUYER` vô nghĩa — người bị báo là chính họ).
    let reporterRole: ReportConversationReporterRole;
    if (row.buyerId === reporterId) reporterRole = 'BUYER';
    else if (row.shop.ownerId === reporterId) reporterRole = 'SHOP';
    else return null;

    return {
      ownedByReporter: false,
      snapshot: {
        shopName: snapshotName(row.shop.name),
        buyerName: snapshotName(row.buyer.name),
        reporterRole,
      },
    };
  }

  // Shop chỉ báo được khi đang công khai (APPROVED) — kể cả với chính chủ shop, để trạng thái shop không bị dò qua mã lỗi.
  private async shop(
    reporterId: string,
    shopId: string,
  ): Promise<ResolvedReportTarget | null> {
    const row = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { ownerId: true, status: true, name: true, slug: true },
    });
    if (!row || row.status !== 'APPROVED') return null;

    return {
      ownedByReporter: row.ownerId === reporterId,
      snapshot: { name: snapshotName(row.name), slug: row.slug },
    };
  }

  // Sản phẩm chỉ báo được khi đang bán công khai (PUBLISHED của shop APPROVED) — cùng điều kiện với mọi truy vấn công khai.
  private async product(
    reporterId: string,
    productId: string,
  ): Promise<ResolvedReportTarget | null> {
    const row = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        name: true,
        status: true,
        shop: { select: { ownerId: true, status: true, name: true } },
      },
    });
    if (!row || row.status !== 'PUBLISHED' || row.shop.status !== 'APPROVED') {
      return null;
    }

    return {
      ownedByReporter: row.shop.ownerId === reporterId,
      snapshot: {
        name: snapshotName(row.name),
        shopName: snapshotName(row.shop.name),
      },
    };
  }
}
