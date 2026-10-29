import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ADMIN_NOTE_TARGET_TYPES } from '@ecommerce/types';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  errorExample,
  FORBIDDEN_ROLE_EXAMPLE,
  UNAUTHORIZED_EXAMPLE,
} from '../../shared/swagger/error-examples';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { AdminNotesService } from './admin-notes.service';
import {
  createAdminNoteSchema,
  type CreateAdminNoteDto,
} from './dto/create-admin-note.dto';
import {
  adminNoteListQuerySchema,
  type ListAdminNotesQueryDto,
} from './dto/list-admin-notes-query.dto';

// Ví dụ chỉ là annotation — khớp adminNoteSchema ở packages/types.
const ADMIN_NOTE_EXAMPLE = {
  id: 'd5b3e4a2-1234-4a5b-8c9d-abcdef999999',
  targetType: 'SHOP',
  targetId: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
  content:
    'Chủ shop đã gọi lại, hẹn bổ sung giấy phép kinh doanh trước thứ Sáu.',
  authorId: 'e6c4f5b3-1234-4a5b-8c9d-abcdef888888',
  authorName: 'Quản trị viên',
  createdAt: '2026-10-28T10:00:00.000Z',
};

// Ghi chú nội bộ của Admin (Week11.md 4.3) — chỉ role ADMIN. Quyền thật nằm ở đây (BE); guard FE chỉ để điều hướng. Controller
// chỉ nhận request và gọi service. Ghi chú KHÔNG nằm trong response của bất kỳ route nào khác (chi tiết người dùng, danh sách
// shop, shop của chủ shop...): đọc ghi chú chỉ có đường này.
@ApiTags('admin')
@Controller('admin/notes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiCookieAuth('access_token')
@ApiResponse({
  status: 401,
  description: 'Chưa đăng nhập',
  schema: { example: UNAUTHORIZED_EXAMPLE },
})
@ApiResponse({
  status: 403,
  description: 'Không phải ADMIN',
  schema: { example: FORBIDDEN_ROLE_EXAMPLE },
})
export class AdminNotesController {
  constructor(private readonly adminNotesService: AdminNotesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Ghi chú nội bộ của MỘT người dùng hoặc shop, mới nhất trước — chỉ ADMIN',
    description:
      'Bắt buộc `targetType` và `targetId`: không có API đọc ghi chú toàn sàn. Đối tượng không tồn tại (hoặc id sai dạng) trả ' +
      '404 thay vì danh sách rỗng. Chỉ có tên Admin viết, không có email. Không cache (Cache-Control: no-store).',
  })
  @ApiQuery({
    name: 'targetType',
    required: true,
    enum: [...ADMIN_NOTE_TARGET_TYPES],
  })
  @ApiQuery({ name: 'targetId', required: true, description: 'UUID' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Tối đa 50',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: { items: [ADMIN_NOTE_EXAMPLE], total: 1, page: 1, limit: 20 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Query không hợp lệ (thiếu hoặc sai targetType / targetId, limit > 50, page quá trần...)',
    schema: { example: errorExample('targetId: Invalid uuid') },
  })
  @ApiResponse({
    status: 404,
    description: 'Người dùng / shop không tồn tại',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Note target not found',
        code: 'ADMIN_NOTE_TARGET_NOT_FOUND',
      },
    },
  })
  list(
    @Query(new ZodValidationPipe(adminNoteListQuerySchema))
    query: ListAdminNotesQueryDto,
  ) {
    return this.adminNotesService.list(query);
  }

  // Tạo tài nguyên mới ⇒ 201 (khai tường minh; Swagger @ApiResponse không tự đọc lại status thật).
  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Thêm một ghi chú nội bộ vào người dùng hoặc shop — chỉ ADMIN; ghi chú chỉ thêm, không sửa hay xoá được',
    description:
      'Tác giả là Admin của phiên (không nhận từ body). Nội dung là văn bản thuần 1–1000 ký tự, có thể nhiều dòng.',
  })
  @ApiBody({
    schema: {
      example: {
        targetType: 'SHOP',
        targetId: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
        content: 'Chủ shop đã gọi lại, hẹn bổ sung giấy phép.',
      },
    },
  })
  @ApiResponse({
    status: 201,
    schema: {
      example: { success: true, data: { note: ADMIN_NOTE_EXAMPLE } },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Body không hợp lệ (nội dung rỗng / quá 1000 ký tự / có ký tự điều khiển, loại đối tượng lạ, id sai dạng)',
    schema: { example: errorExample('content: admin.validationNoteRequired') },
  })
  @ApiResponse({
    status: 404,
    description: 'Người dùng / shop không tồn tại',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Note target not found',
        code: 'ADMIN_NOTE_TARGET_NOT_FOUND',
      },
    },
  })
  create(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(createAdminNoteSchema))
    body: CreateAdminNoteDto,
  ) {
    return this.adminNotesService.create(admin.userId, body);
  }
}
