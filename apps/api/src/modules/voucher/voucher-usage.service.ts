import { Injectable } from '@nestjs/common';
import { AppException } from '../../shared/exceptions/app.exception';
import type { TxClient } from '../../shared/prisma/tx-client';

export interface ConsumeVoucherParams {
  voucherId: string;
  userId: string;
  checkoutGroupId: string;
  // Tổng số giảm của lần checkout này (= tổng Order.discountAmount của nhóm), số nguyên VND.
  discountAmount: number;
  // Lấy từ voucher đã đọc; null = không giới hạn theo user.
  perUserLimit: number | null;
}

// Sở hữu VoucherUsage và việc tăng/giảm Voucher.usedCount (Week7.md 1.5/1.14). "1 lần dùng mã"
// = 1 lần checkout, không suy ra được từ số Order (voucher toàn sàn tách N đơn vẫn 1 lượt).
//
// Như InventoryService: nhận `tx` đầu tiên, không mở $transaction lồng.
@Injectable()
export class VoucherUsageService {
  // THỨ TỰ BẮT BUỘC (đọc-rồi-ghi sẽ để 2 checkout song song cùng lọt perUserLimit):
  //  1. tăng usedCount có điều kiện — câu này giữ khoá dòng voucher tới hết transaction nên
  //     mọi checkout dùng cùng voucher bị xếp hàng ở đây (usedCount đóng vai mutex);
  //  2. SAU ĐÓ mới đếm perUserLimit — đã cầm khoá nên thấy đủ các lần dùng đã commit;
  //  3. INSERT VoucherUsage (unique [voucherId, checkoutGroupId] là trọng tài cuối).
  // Thông điệp lỗi giữ nguyên chữ vì FE đang nhận diện theo chữ (voucher-error.ts).
  async consume(tx: TxClient, params: ConsumeVoucherParams): Promise<void> {
    const { voucherId, userId, checkoutGroupId, discountAmount, perUserLimit } =
      params;

    const affected = await tx.$executeRaw`
      UPDATE vouchers
      SET used_count = used_count + 1
      WHERE id = ${voucherId}
        AND (usage_limit IS NULL OR used_count < usage_limit)`;
    if (affected !== 1) {
      const exists = await tx.voucher.count({ where: { id: voucherId } });
      if (exists === 0) {
        throw new AppException(404, 'VOUCHER_NOT_FOUND', 'Voucher not found');
      }
      throw new AppException(
        400,
        'VOUCHER_USAGE_LIMIT_REACHED',
        'Voucher usage limit has been reached',
      );
    }

    if (perUserLimit !== null) {
      const used = await this.countActiveByUser(tx, voucherId, userId);
      if (used >= perUserLimit) {
        throw new AppException(
          400,
          'VOUCHER_PER_USER_LIMIT_REACHED',
          'You have reached the usage limit for this voucher',
        );
      }
    }

    await tx.voucherUsage.create({
      data: { voucherId, userId, checkoutGroupId, discountAmount },
    });
  }

  // Nhả lượt của 1 nhóm (thanh toán thất bại/hết hạn). Nhả bằng `releasedAt` (xoá mềm, giữ lịch
  // sử cho đối soát/hoàn tiền); lượt lật `releasedAt IS NULL → now()` là ổ khoá idempotent: chỉ
  // lần lật thành công mới trừ usedCount, gọi lặp/song song không trừ 2 lần. Trả số lượt đã nhả.
  async release(tx: TxClient, checkoutGroupId: string): Promise<number> {
    const usages = await tx.voucherUsage.findMany({
      where: { checkoutGroupId, releasedAt: null },
      select: { id: true, voucherId: true },
      // Cùng thứ tự khoá với đường đặt hàng: theo voucher tăng dần.
      orderBy: { voucherId: 'asc' },
    });

    let released = 0;
    for (const usage of usages) {
      const { count } = await tx.voucherUsage.updateMany({
        where: { id: usage.id, releasedAt: null },
        data: { releasedAt: new Date() },
      });
      if (count !== 1) continue;
      await tx.voucher.updateMany({
        where: { id: usage.voucherId, usedCount: { gt: 0 } },
        data: { usedCount: { decrement: 1 } },
      });
      released += 1;
    }
    return released;
  }

  // Số lần user đã dùng voucher mà CHƯA nhả (gồm cả lần đang giữ chỗ chờ thanh toán).
  countActiveByUser(
    client: Pick<TxClient, 'voucherUsage'>,
    voucherId: string,
    userId: string,
  ): Promise<number> {
    return client.voucherUsage.count({
      where: { voucherId, userId, releasedAt: null },
    });
  }
}
