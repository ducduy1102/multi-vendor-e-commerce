import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

// Khung module (Week9.md 2.0). Nghiệp vụ review/rating (điều kiện viết, sửa một lần, trả lời của seller,
// đọc công khai) làm ở 2.10; cập nhật Product.avgRating/reviewCount đi qua ProductRatingService của module
// `product` (điểm ghi duy nhất), không ghi thẳng từ đây.
@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}
}
