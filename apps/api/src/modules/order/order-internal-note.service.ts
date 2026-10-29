import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { redactWriteError } from '../../shared/utils/redact-write-error';
import { sellerVisibleOrderFilter } from './seller-order-visibility';

const orderIdSchema = z.string().uuid();

const orderNotFound = () =>
  new AppException(404, 'ORDER_NOT_FOUND', 'Order not found');

// Ghi chú nội bộ của shop trên đơn (Week11.md 4.4): chỗ shop tự nhắc mình ("đã gọi khách xác nhận địa chỉ", "hàng dễ vỡ, bọc kỹ").
// Khác lời nhắn của người mua (`buyerNote`, người mua viết cho shop) và khác lý do đổi trạng thái (người mua đọc được).
//
// - Chỉ chủ shop: `shopId` đã được ShopOwnerGuard xác nhận là của người gọi; câu UPDATE có điều kiện còn gắn `shopId` và đúng bộ
//   lọc "Seller được thấy đơn này" (sellerVisibleOrderFilter) nên đơn của shop khác, đơn chưa thanh toán và đơn không tồn tại
//   cùng ra MỘT 404 như mọi route đơn của Seller — không phân biệt, không lộ id nào có thật.
// - Id đơn sai dạng (kể cả có ký tự NUL mà Postgres không nhận và sẽ thành 500) cũng ra cùng 404, không chạm DB.
// - MỘT câu UPDATE có điều kiện, không đọc-rồi-ghi (rules/backend.md mục 4): không có khe giữa "kiểm quyền" và "ghi".
// - Ghi ở MỌI trạng thái nhìn thấy được (kể cả đơn đã hoàn tất / đã hủy): shop vẫn cần ghi chú về một đơn đã đóng, và ghi chú không
//   đổi tiền, kho hay trạng thái nên không cần khoá đơn.
// - Lỗi ghi của Prisma mang NGUYÊN giá trị đã ghi (cả hàng vi phạm CHECK): đi qua redactWriteError để nội dung ghi chú không vào log.
@Injectable()
export class OrderInternalNoteService {
  constructor(private readonly prisma: PrismaService) {}

  // `note` đã được Zod chuẩn hoá (trim, LF); chuỗi rỗng hoặc null = xoá ghi chú (lưu NULL, không bao giờ lưu chuỗi rỗng).
  async setInternalNote(
    shopId: string,
    orderId: string,
    note: string | null,
  ): Promise<void> {
    if (!orderIdSchema.safeParse(orderId).success) throw orderNotFound();

    let updated: { count: number };
    try {
      updated = await this.prisma.order.updateMany({
        where: { id: orderId, shopId, ...sellerVisibleOrderFilter() },
        data: { internalNote: note === null || note === '' ? null : note },
      });
    } catch (error) {
      throw redactWriteError(error, 'order internal note');
    }
    if (updated.count === 0) throw orderNotFound();
  }
}
