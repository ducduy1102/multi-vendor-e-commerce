import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ShopOwnerContext } from '../../shared/decorators/shop-owner-context.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { ShopOwnerGuard } from '../../shared/guards/shop-owner.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  createVoucherSchema,
  type CreateVoucherDto,
} from './dto/create-voucher.dto';
import {
  setVoucherActiveSchema,
  type SetVoucherActiveDto,
} from './dto/set-voucher-active.dto';
import { VoucherService } from './voucher.service';

// DTO validate bằng Zod nên khai @ApiBody/@ApiResponse bằng example thủ công
// (giống ProductController).
const VOUCHER_EXAMPLE = {
  id: 'e5f6a7b8-1234-4a5b-8c9d-abcdef777777',
  shopId: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
  code: 'SALE10',
  type: 'PERCENT',
  value: '10',
  minOrderAmount: '200000',
  maxDiscountAmount: '50000',
  usageLimit: 100,
  perUserLimit: 1,
  usedCount: 0,
  isActive: true,
  expiresAt: '2030-01-01T00:00:00.000Z',
  createdAt: '2026-09-25T00:00:00.000Z',
};

// shopId lấy qua @ShopOwnerContext() (do ShopOwnerGuard resolve sẵn) chứ không
// qua @Param('shopId') nên Swagger không tự suy ra tham số đường dẫn này — phải
// khai tay bằng @ApiParam, nếu không "Try it out" không có ô nhập shopId.
const SHOP_ID_PARAM = {
  name: 'shopId',
  description: 'Id của shop mình sở hữu',
  example: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
};

// Chỉ có route quản lý voucher theo shop (Seller). Áp mã cho giỏ hàng đi qua
// /cart (GET /cart?voucherCode, POST /cart/quote) — không có route
// /vouchers/validate riêng, và không có route tạo voucher toàn sàn (chỉ seed
// tay, Week6.md 1.14/2.6). Không có prefix chung ở @Controller() vì path
// nằm dưới shops/:shopId.
@ApiTags('voucher')
@Controller()
export class VoucherController {
  constructor(private readonly voucherService: VoucherService) {}

  @Post('shops/:shopId/vouchers')
  @ApiParam(SHOP_ID_PARAM)
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Tạo voucher cho shop của mình — mã tự chuẩn hoá chữ HOA, duy nhất toàn hệ thống',
  })
  @ApiBody({
    schema: {
      example: {
        code: 'sale10',
        type: 'PERCENT',
        value: 10,
        minOrderAmount: 200000,
        maxDiscountAmount: 50000,
        usageLimit: 100,
        perUserLimit: 1,
        expiresAt: '2030-01-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 201,
    schema: {
      example: { success: true, data: { voucher: VOUCHER_EXAMPLE } },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Dữ liệu không hợp lệ, hoặc ngày hết hạn ở quá khứ',
  })
  @ApiResponse({ status: 403, description: 'Không phải chủ shop' })
  @ApiResponse({ status: 404, description: 'Shop không tồn tại' })
  @ApiResponse({
    status: 409,
    description: 'Mã voucher đã tồn tại (code: VOUCHER_CODE_EXISTS)',
  })
  async create(
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Body(new ZodValidationPipe(createVoucherSchema)) dto: CreateVoucherDto,
  ) {
    const voucher = await this.voucherService.createVoucher(shopId, dto);
    return { voucher };
  }

  @Get('shops/:shopId/vouchers')
  @ApiParam(SHOP_ID_PARAM)
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Danh sách voucher của shop mình — kể cả đang tắt/đã hết hạn',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: { success: true, data: { items: [VOUCHER_EXAMPLE] } },
    },
  })
  @ApiResponse({ status: 403, description: 'Không phải chủ shop' })
  @ApiResponse({ status: 404, description: 'Shop không tồn tại' })
  async listMine(@ShopOwnerContext() { shopId }: { shopId: string }) {
    const items = await this.voucherService.listMyVouchers(shopId);
    return { items };
  }

  // Route lồng 2 cấp (không phải PATCH /vouchers/:id) vì ShopOwnerGuard với
  // route phẳng tự tra shopId theo product id, không hiểu voucher.
  @Patch('shops/:shopId/vouchers/:voucherId')
  @ApiParam(SHOP_ID_PARAM)
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Bật/tắt voucher của shop mình (đặt isActive tường minh, idempotent)',
  })
  @ApiBody({ schema: { example: { isActive: false } } })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: { voucher: { ...VOUCHER_EXAMPLE, isActive: false } },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Không phải chủ shop' })
  @ApiResponse({
    status: 404,
    description:
      'Shop hoặc voucher không tồn tại (kể cả voucher của shop khác)',
  })
  async setActive(
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Param('voucherId') voucherId: string,
    @Body(new ZodValidationPipe(setVoucherActiveSchema))
    dto: SetVoucherActiveDto,
  ) {
    const voucher = await this.voucherService.setVoucherActive(
      shopId,
      voucherId,
      dto.isActive,
    );
    return { voucher };
  }
}
