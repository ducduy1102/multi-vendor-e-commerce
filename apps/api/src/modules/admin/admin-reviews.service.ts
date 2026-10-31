import { Injectable } from '@nestjs/common';
import type { ReviewModerationResponse } from '@ecommerce/types';
import type { AuditRequestContext } from '../../shared/audit/audit-request-context';
import { AppException } from '../../shared/exceptions/app.exception';
import { ReviewService } from '../review/review.service';
import { isUuid } from './admin-user-id';

// Ẩn / hiện MỘT đánh giá không qua báo cáo (Week11.md 5.5, D6), phía ADMIN. Quyền ở controller (JwtAuthGuard + RolesGuard). Luật ẩn
// nằm ở ReviewService (khoá product → đặt cột → tính lại điểm → nhật ký, cùng transaction) và được xử lý báo cáo dùng lại y hệt; lớp
// này chỉ kiểm dạng id. Đánh giá không tồn tại và id sai dạng (kể cả có NUL mà Postgres không nhận và sẽ thành 500) ra cùng một 404.
@Injectable()
export class AdminReviewsService {
  constructor(private readonly reviewService: ReviewService) {}

  hide(
    adminId: string,
    reviewId: string,
    reason: string,
    context: AuditRequestContext = {},
  ): Promise<ReviewModerationResponse> {
    this.assertReviewId(reviewId);
    return this.reviewService.hide({ adminId, reviewId, reason, context });
  }

  unhide(
    adminId: string,
    reviewId: string,
    reason: string,
    context: AuditRequestContext = {},
  ): Promise<ReviewModerationResponse> {
    this.assertReviewId(reviewId);
    return this.reviewService.unhide({ adminId, reviewId, reason, context });
  }

  private assertReviewId(reviewId: string): void {
    if (!isUuid(reviewId)) {
      throw new AppException(404, 'REVIEW_NOT_FOUND', 'Review not found');
    }
  }
}
