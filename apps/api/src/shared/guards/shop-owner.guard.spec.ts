import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ShopOwnerGuard } from './shop-owner.guard';
import { PrismaService } from '../prisma/prisma.service';

interface MockRequest {
  user?: { userId: string; role: string };
  params: Record<string, string>;
  shopOwnerContext?: { shopId: string; productId?: string };
}

function createContext(request: MockRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('ShopOwnerGuard', () => {
  let guard: ShopOwnerGuard;
  let prisma: {
    shop: { findUnique: jest.Mock };
    product: { findUnique: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      shop: { findUnique: jest.fn() },
      product: { findUnique: jest.fn() },
    };
    guard = new ShopOwnerGuard(prisma as unknown as PrismaService);
  });

  it('chặn nếu không có req.user (guard đặt sai thứ tự, thiếu JwtAuthGuard trước đó)', async () => {
    const request: MockRequest = { user: undefined, params: { shopId: 's1' } };
    await expect(guard.canActivate(createContext(request))).resolves.toBe(
      false,
    );
    expect(prisma.shop.findUnique).not.toHaveBeenCalled();
  });

  describe('route lồng (param shopId)', () => {
    it('cho qua đúng chủ shop, gán shopOwnerContext không có productId', async () => {
      prisma.shop.findUnique.mockResolvedValue({ ownerId: 'user-1' });
      const request: MockRequest = {
        user: { userId: 'user-1', role: 'USER' },
        params: { shopId: 'shop-1' },
      };

      await expect(guard.canActivate(createContext(request))).resolves.toBe(
        true,
      );
      expect(prisma.product.findUnique).not.toHaveBeenCalled();
      expect(request.shopOwnerContext).toEqual({
        shopId: 'shop-1',
        productId: undefined,
      });
    });

    it('báo lỗi 403 nếu không phải chủ shop', async () => {
      prisma.shop.findUnique.mockResolvedValue({ ownerId: 'user-1' });
      const request: MockRequest = {
        user: { userId: 'user-2', role: 'USER' },
        params: { shopId: 'shop-1' },
      };

      await expect(
        guard.canActivate(createContext(request)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('báo lỗi 404 nếu shop không tồn tại', async () => {
      prisma.shop.findUnique.mockResolvedValue(null);
      const request: MockRequest = {
        user: { userId: 'user-1', role: 'USER' },
        params: { shopId: 'shop-missing' },
      };

      await expect(
        guard.canActivate(createContext(request)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('route phẳng (param id — productId, tự tra shopId)', () => {
    it('cho qua đúng chủ shop, gán shopOwnerContext kèm productId', async () => {
      prisma.product.findUnique.mockResolvedValue({ shopId: 'shop-1' });
      prisma.shop.findUnique.mockResolvedValue({ ownerId: 'user-1' });
      const request: MockRequest = {
        user: { userId: 'user-1', role: 'USER' },
        params: { id: 'product-1' },
      };

      await expect(guard.canActivate(createContext(request))).resolves.toBe(
        true,
      );
      expect(request.shopOwnerContext).toEqual({
        shopId: 'shop-1',
        productId: 'product-1',
      });
    });

    it('báo lỗi 404 nếu product không tồn tại', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      const request: MockRequest = {
        user: { userId: 'user-1', role: 'USER' },
        params: { id: 'product-missing' },
      };

      await expect(
        guard.canActivate(createContext(request)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.shop.findUnique).not.toHaveBeenCalled();
    });

    it('báo lỗi 403 nếu shop của product không thuộc user hiện tại', async () => {
      prisma.product.findUnique.mockResolvedValue({ shopId: 'shop-1' });
      prisma.shop.findUnique.mockResolvedValue({ ownerId: 'user-1' });
      const request: MockRequest = {
        user: { userId: 'user-2', role: 'USER' },
        params: { id: 'product-1' },
      };

      await expect(
        guard.canActivate(createContext(request)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
