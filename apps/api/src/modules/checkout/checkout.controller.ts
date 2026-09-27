import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

// Route chốt ở Week7.md 1.14: POST /checkout, POST /checkout/preview,
// GET /checkout/groups/:groupId, POST /checkout/groups/:groupId/pay.
// `/addresses` sẽ có controller riêng cùng module (2.6).
@ApiTags('checkout')
@Controller('checkout')
export class CheckoutController {}
