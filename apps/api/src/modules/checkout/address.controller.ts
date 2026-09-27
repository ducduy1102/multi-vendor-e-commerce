import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { MAX_ADDRESSES_PER_USER } from '@ecommerce/types';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { AddressService } from './address.service';
import {
  createAddressSchema,
  updateAddressSchema,
  type CreateAddressDto,
  type UpdateAddressDto,
} from './dto/address.dto';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';

// DTO validate bằng Zod (không phải class) — khai @ApiBody/@ApiResponse bằng example thủ công,
// giống ProductController/VoucherController.
const ADDRESS_EXAMPLE = {
  id: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
  recipientName: 'Nguyễn Văn A',
  phone: '0912345678',
  line1: '12 Nguyễn Huệ',
  ward: 'Phường Bến Nghé',
  province: 'Hồ Chí Minh',
  isDefault: true,
  createdAt: '2026-09-27T00:00:00.000Z',
};

// Sổ địa chỉ GIAO HÀNG của user đang đăng nhập (Week7.md 1.8) — chưa có trang quản lý riêng (Tuần 8),
// dùng ngay trong /checkout. KHÔNG cần EmailVerifiedGuard (chỉ chặn ở bước đặt hàng thật, 1.2).
@ApiTags('addresses')
@Controller('addresses')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth('access_token')
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  @Get()
  @ApiOperation({
    summary: 'Sổ địa chỉ của tôi — mặc định trước, mới nhất trước',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: { success: true, data: { addresses: [ADDRESS_EXAMPLE] } },
    },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async list(@CurrentUser() user: AuthenticatedUser) {
    const addresses = await this.addressService.listMyAddresses(user.userId);
    return { addresses };
  }

  @Post()
  @ApiOperation({
    summary: 'Thêm địa chỉ mới — địa chỉ đầu tiên tự làm mặc định',
  })
  @ApiResponse({
    status: 201,
    schema: { example: { success: true, data: { address: ADDRESS_EXAMPLE } } },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 409,
    description: `Đã đủ ${MAX_ADDRESSES_PER_USER} địa chỉ (code: ADDRESS_LIMIT_REACHED)`,
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createAddressSchema)) dto: CreateAddressDto,
  ) {
    const address = await this.addressService.createAddress(user.userId, dto);
    return { address };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Sửa 1 phần địa chỉ' })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: { address: ADDRESS_EXAMPLE } } },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 404,
    description: 'Địa chỉ không tồn tại hoặc không phải của bạn',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAddressSchema)) dto: UpdateAddressDto,
  ) {
    const address = await this.addressService.updateAddress(
      user.userId,
      id,
      dto,
    );
    return { address };
  }

  // 200 + envelope theo tiền lệ dự án (rules/backend.md mục 2), không phải 204 trần.
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xoá địa chỉ — không ảnh hưởng đơn cũ (Order giữ snapshot)',
  })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: null } },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 404,
    description: 'Địa chỉ không tồn tại hoặc không phải của bạn',
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.addressService.deleteAddress(user.userId, id);
    return null;
  }

  @Patch(':id/default')
  @ApiOperation({ summary: 'Đặt làm địa chỉ mặc định — idempotent' })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: { address: ADDRESS_EXAMPLE } } },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 404,
    description: 'Địa chỉ không tồn tại hoặc không phải của bạn',
  })
  async setDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const address = await this.addressService.setDefaultAddress(
      user.userId,
      id,
    );
    return { address };
  }
}
