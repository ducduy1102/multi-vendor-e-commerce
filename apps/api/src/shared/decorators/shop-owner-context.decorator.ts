import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ShopOwnerContext as ShopOwnerContextType } from '../guards/shop-owner.guard';

interface RequestWithShopOwnerContext extends Request {
  shopOwnerContext: ShopOwnerContextType;
}

// @ShopOwnerContext() — lấy { shopId, productId? } do ShopOwnerGuard resolve
// sẵn (đã xác nhận đúng chủ), tránh handler tự đọc lại @Param('shopId')/
// @Param('id') rồi query DB lần 2 cho cùng việc.
export const ShopOwnerContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ShopOwnerContextType => {
    const request = ctx
      .switchToHttp()
      .getRequest<RequestWithShopOwnerContext>();
    return request.shopOwnerContext;
  },
);
