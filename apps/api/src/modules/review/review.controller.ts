import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

// Không có prefix chung ở @Controller() vì route nằm ở 3 nhánh khác nhau — `reviews` (buyer viết/sửa),
// `products/:idOrSlug/reviews` (đọc công khai), `shops/:shopId/reviews` (seller xem/trả lời) — cùng cách
// VoucherController/SellerOrderController. Route thật làm ở Week9.md 2.10.
@ApiTags('reviews')
@Controller()
export class ReviewController {}
