import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  ChatDirectory,
  ChatShopInfo,
  ChatUserDisplay,
} from './chat-directory';

// Chỉ những cột chat cần — không kéo cả hàng shop (mô tả, banner, lý do trạng thái...), và quan trọng hơn là không
// để lọt thứ không được lộ ra response.
const SHOP_SELECT = {
  id: true,
  ownerId: true,
  status: true,
  name: true,
  logoUrl: true,
} as const;

// Bản cài đặt ChatDirectory dùng Prisma.
@Injectable()
export class PrismaChatDirectory implements ChatDirectory {
  constructor(private readonly prisma: PrismaService) {}

  getShopForChat(shopId: string): Promise<ChatShopInfo | null> {
    return this.prisma.shop.findUnique({
      where: { id: shopId },
      select: SHOP_SELECT,
    });
  }

  async getShopsForChat(shopIds: string[]): Promise<ChatShopInfo[]> {
    const ids = [...new Set(shopIds)];
    if (ids.length === 0) return [];
    return this.prisma.shop.findMany({
      where: { id: { in: ids } },
      select: SHOP_SELECT,
    });
  }

  // `select: { id, name }` là chốt chặn duy nhất giữa dữ liệu người dùng và đối phương: không thêm email/SĐT vào đây.
  async getUserDisplay(userIds: string[]): Promise<ChatUserDisplay[]> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return [];
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
  }
}
