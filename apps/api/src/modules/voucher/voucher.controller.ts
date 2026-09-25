import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VoucherService } from './voucher.service';

@ApiTags('vouchers')
@Controller('vouchers')
export class VoucherController {
  constructor(private readonly voucherService: VoucherService) {}
}
