import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { ChatDirectory, ChatShopInfo } from './chat-directory';

// Bản cài đặt ChatDirectory dùng Prisma. `select` hẹp CHỈ những cột chat cần — không kéo cả hàng shop (mô tả,
// banner, trạng thái lý do...), và quan trọng hơn là không để lọt thứ không được lộ ra response.
@Injectable()
export class PrismaChatDirectory implements ChatDirectory {
  constructor(private readonly prisma: PrismaService) {}

  getShopForChat(shopId: string): Promise<ChatShopInfo | null> {
    return this.prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        id: true,
        ownerId: true,
        status: true,
        name: true,
        logoUrl: true,
      },
    });
  }
}
