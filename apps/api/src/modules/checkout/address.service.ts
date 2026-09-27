import { Injectable, NotFoundException } from '@nestjs/common';
import { MAX_ADDRESSES_PER_USER } from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

// Chỉ sổ địa chỉ GIAO HÀNG của user (Week7.md 1.8 mục 3) — shopId luôn null, địa chỉ lấy hàng của
// shop chưa làm ở Tuần 7. Mọi query bắt buộc kèm `where userId` lấy từ req.user, KHÔNG tin id/userId
// từ client (rules/backend.md mục 5); địa chỉ của người khác coi như không tồn tại (404, không phân
// biệt "không có" và "của người khác" để khỏi lộ thông tin).
const addressSelect = {
  id: true,
  recipientName: true,
  phone: true,
  line1: true,
  ward: true,
  province: true,
  isDefault: true,
  createdAt: true,
} as const;

@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  listMyAddresses(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: addressSelect,
    });
  }

  // Địa chỉ đầu tiên của user tự làm mặc định. Race tạo song song có thể vượt trần 1-2 địa chỉ —
  // hậu quả không đáng kể nên không khoá cả bảng (Week7.md 1.8 mục 5, ghi nhận có chủ đích).
  async createAddress(userId: string, dto: CreateAddressDto) {
    const count = await this.prisma.address.count({ where: { userId } });
    if (count >= MAX_ADDRESSES_PER_USER) {
      throw new AppException(
        409,
        'ADDRESS_LIMIT_REACHED',
        `Address limit reached (max ${MAX_ADDRESSES_PER_USER})`,
      );
    }
    return this.prisma.address.create({
      data: { ...dto, userId, isDefault: count === 0 },
      select: addressSelect,
    });
  }

  async updateAddress(
    userId: string,
    addressId: string,
    dto: UpdateAddressDto,
  ) {
    await this.assertOwnership(userId, addressId);
    return this.prisma.address.update({
      where: { id: addressId },
      data: dto,
      select: addressSelect,
    });
  }

  // Xoá cứng được — Order giữ snapshot, không có FK sống tới Address (note-db.md mục 3), nên sửa/xoá
  // địa chỉ không ảnh hưởng đơn cũ. Xoá địa chỉ mặc định thì địa chỉ tạo gần nhất còn lại trở thành
  // mặc định, trong CÙNG transaction.
  async deleteAddress(userId: string, addressId: string): Promise<void> {
    const address = await this.assertOwnership(userId, addressId);

    await this.prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id: addressId } });
      if (!address.isDefault) return;

      const next = await tx.address.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (next) {
        await tx.address.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    });
  }

  // Idempotent — đặt mặc định cho địa chỉ đã đang mặc định vẫn trả về bình thường, không lỗi.
  // Đổi mặc định TRONG TRANSACTION, bỏ mặc định cũ TRƯỚC rồi mới đặt mới — không vi phạm chỉ mục
  // duy nhất từng phần "mỗi user tối đa 1 địa chỉ mặc định" giữa chừng (Week7.md 1.8 mục 4).
  async setDefaultAddress(userId: string, addressId: string) {
    await this.assertOwnership(userId, addressId);

    return this.prisma.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: { userId, isDefault: true, id: { not: addressId } },
        data: { isDefault: false },
      });
      return tx.address.update({
        where: { id: addressId },
        data: { isDefault: true },
        select: addressSelect,
      });
    });
  }

  private async assertOwnership(userId: string, addressId: string) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
      select: { isDefault: true },
    });
    if (!address) {
      throw new NotFoundException('Address not found');
    }
    return address;
  }
}
