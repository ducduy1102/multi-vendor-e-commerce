import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

// Ở Tuần 7 controller này chỉ chứa các endpoint callback của cổng thanh toán
// (`/payments/...`, không JWT, xác thực bằng chữ ký — 2.9). Route đơn hàng
// (`/orders`) thuộc Tuần 8.
@ApiTags('payments')
@Controller('payments')
export class OrderController {}
