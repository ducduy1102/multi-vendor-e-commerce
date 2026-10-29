import { Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { ShopOwnerContext } from '../../shared/decorators/shop-owner-context.decorator';
import { EmailVerifiedGuard } from '../../shared/guards/email-verified.guard';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { ShopOwnerGuard } from '../../shared/guards/shop-owner.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  errorExample,
  UNAUTHORIZED_EXAMPLE,
} from '../../shared/swagger/error-examples';
import { AppealService } from './appeal.service';
import {
  createAppealSchema,
  type CreateAppealDto,
} from './dto/create-appeal.dto';

// `appeal` không import `auth` (ranh giới module): chỉ cần `userId` nên dùng kiểu cấu trúc nhỏ thay vì AuthenticatedUser.
interface Caller {
  userId: string;
}

// Ví dụ chỉ là annotation — khớp ownerAppealSchema ở packages/types.
const OWNER_APPEAL_EXAMPLE = {
  id: 'f1a2b3c4-1234-4a5b-8c9d-abcdef777777',
  state: 'PENDING',
  message:
    'Shop đã bổ sung giấy phép kinh doanh và gỡ các sản phẩm bị báo cáo, mong sàn xem xét mở khoá lại.',
  decisionNote: null,
  createdAt: '2026-10-30T02:00:00.000Z',
  decidedAt: null,
  moderationEventAt: '2026-10-29T08:30:00.000Z',
};

// Kháng nghị của chủ shop (Week11.md 4.6): chủ shop đã đăng nhập, đúng chủ của `:shopId` (ShopOwnerGuard: 404 nếu shop không tồn
// tại, 403 nếu không phải chủ). Controller chỉ nhận request và gọi service; luật "được kháng nghị khi nào" nằm ở AppealService.
@ApiTags('appeals')
@Controller('shops/:shopId/appeals')
@UseGuards(JwtAuthGuard, ShopOwnerGuard)
@ApiCookieAuth('access_token')
@ApiResponse({
  status: 401,
  description: 'Chưa đăng nhập',
  schema: { example: UNAUTHORIZED_EXAMPLE },
})
@ApiResponse({
  status: 403,
  description: 'Không phải chủ shop',
  schema: { example: errorExample('Not the shop owner') },
})
@ApiResponse({
  status: 404,
  description: 'Shop không tồn tại',
  schema: { example: errorExample('Shop not found') },
})
export class ShopAppealController {
  constructor(private readonly appealService: AppealService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Lịch sử kháng nghị của shop và có được kháng nghị lúc này không',
    description:
      'Tối đa 20 kháng nghị gần nhất, mới nhất trước. `canAppeal` do server tính theo đúng luật của POST: shop đang bị Admin ' +
      'khoá (SUSPENDED, không phải khoá theo cascade tài khoản) và lần khoá này chưa có kháng nghị nào. `state` = PENDING | ' +
      'ACCEPTED | REJECTED | CLOSED (CLOSED: còn chờ nhưng lần khoá đã kết thúc). Dữ liệu riêng tư — không cache.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: { appeals: [OWNER_APPEAL_EXAMPLE], canAppeal: false },
      },
    },
  })
  list(@ShopOwnerContext() { shopId }: { shopId: string }) {
    return this.appealService.listForShop(shopId);
  }

  @Post()
  @UseGuards(EmailVerifiedGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Gửi kháng nghị lần khoá shop hiện tại (mỗi lần bị khoá chỉ một lần)',
    description:
      'Chỉ khi shop đang SUSPENDED do một Admin khoá và lần khoá này chưa có kháng nghị. Body chỉ có `message` (1–1.000 ký tự, ' +
      'văn bản thuần): người gửi lấy từ phiên, shop từ đường dẫn, mốc bị khoá do server đọc. Cần xác thực email. Mọi Admin ' +
      'ACTIVE nhận thông báo.',
  })
  @ApiBody({ schema: { example: { message: OWNER_APPEAL_EXAMPLE.message } } })
  @ApiResponse({
    status: 201,
    schema: { example: { success: true, data: OWNER_APPEAL_EXAMPLE } },
  })
  @ApiResponse({
    status: 400,
    description:
      'Lời kháng nghị trống, quá 1.000 ký tự hoặc có ký tự điều khiển',
    schema: {
      example: errorExample('message: appeal.validationMessageRequired'),
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Không phải chủ shop, hoặc email chưa xác thực',
    schema: { example: errorExample('Not the shop owner') },
  })
  @ApiResponse({
    status: 409,
    description:
      'Shop không ở trạng thái được kháng nghị (APPEAL_NOT_ALLOWED) hoặc lần khoá này đã có kháng nghị (APPEAL_ALREADY_SENT)',
    schema: {
      example: errorExample('This shop cannot be appealed right now', {
        code: 'APPEAL_NOT_ALLOWED',
      }),
    },
  })
  create(
    @CurrentUser() user: Caller,
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Body(new ZodValidationPipe(createAppealSchema)) body: CreateAppealDto,
  ) {
    return this.appealService.create(user.userId, shopId, body);
  }
}
