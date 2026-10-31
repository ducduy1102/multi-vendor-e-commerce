import { Injectable } from '@nestjs/common';
import type { ProductModerationResponse } from '@ecommerce/types';
import type { AuditRequestContext } from '../../shared/audit/audit-request-context';
import { AppException } from '../../shared/exceptions/app.exception';
import { ProductModerationService } from '../product/product-moderation.service';
import { isUuid } from './admin-user-id';

// Gỡ / khôi phục MỘT sản phẩm không qua báo cáo (Week11.md 5.7, D5), phía ADMIN. Quyền ở controller (JwtAuthGuard + RolesGuard). Luật gỡ
// nằm ở ProductModerationService (UPDATE có điều kiện + nhật ký, cùng transaction) và được xử lý báo cáo dùng lại y hệt; lớp này chỉ kiểm
// dạng id. Sản phẩm không tồn tại và id sai dạng (kể cả có NUL mà Postgres không nhận và sẽ thành 500) ra cùng một 404.
@Injectable()
export class AdminProductsService {
  constructor(private readonly moderationService: ProductModerationService) {}

  takeDown(
    adminId: string,
    productId: string,
    reason: string,
    context: AuditRequestContext = {},
  ): Promise<ProductModerationResponse> {
    this.assertProductId(productId);
    return this.moderationService.takeDown({
      adminId,
      productId,
      reason,
      context,
    });
  }

  restore(
    adminId: string,
    productId: string,
    reason: string,
    context: AuditRequestContext = {},
  ): Promise<ProductModerationResponse> {
    this.assertProductId(productId);
    return this.moderationService.restore({
      adminId,
      productId,
      reason,
      context,
    });
  }

  private assertProductId(productId: string): void {
    if (!isUuid(productId)) {
      throw new AppException(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    }
  }
}
