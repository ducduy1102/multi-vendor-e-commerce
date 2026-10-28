import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AdminNote,
  AdminNoteCreatedResponse,
  AdminNoteListResponse,
  AdminNoteTargetType,
} from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { redactWriteError } from '../../shared/utils/redact-write-error';
import { isUuid } from './admin-user-id';
import type { CreateAdminNoteDto } from './dto/create-admin-note.dto';
import type { ListAdminNotesQueryDto } from './dto/list-admin-notes-query.dto';

// Cột của ghi chú được đọc. Thêm cột vào đây là thêm vào bề mặt lộ dữ liệu: phải kèm trường tương ứng ở `adminNoteSchema`
// (packages/types) VÀ ở `toAdminNote` (response dựng bằng object literal tường minh, không spread).
const adminNoteSelect = {
  id: true,
  targetType: true,
  targetId: true,
  authorId: true,
  content: true,
  createdAt: true,
} satisfies Prisma.AdminNoteSelect;

type AdminNoteRow = Prisma.AdminNoteGetPayload<{
  select: typeof adminNoteSelect;
}>;

export function toAdminNote(
  row: AdminNoteRow,
  authorName: string | null,
): AdminNote {
  return {
    id: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    content: row.content,
    authorId: row.authorId,
    authorName,
    createdAt: row.createdAt.toISOString(),
  };
}

const targetNotFound = () =>
  new AppException(404, 'ADMIN_NOTE_TARGET_NOT_FOUND', 'Note target not found');

// Ghi chú nội bộ của Admin (Week11.md 4.3, D15). CHỈ THÊM: service này không có phương thức sửa/xoá (và
// `admin-note-append-only.spec.ts` quét toàn bộ mã nguồn). Chỉ Admin đọc/ghi — quyền ở controller (JwtAuthGuard + RolesGuard);
// tác giả luôn là Admin của phiên (`adminId` truyền từ controller), không bao giờ từ body. Không có log nào nhắc tới nội dung
// ghi chú; lỗi ghi của Prisma mang giá trị đã ghi (cả hàng vi phạm CHECK) được che bằng redactWriteError.
@Injectable()
export class AdminNotesService {
  constructor(private readonly prisma: PrismaService) {}

  // Ghi chú của MỘT đối tượng, mới nhất trước (created_at, id giảm dần — id là khoá phụ nên phân trang không trùng/mất khi hai
  // ghi chú cùng mili-giây). Đối tượng không tồn tại ⇒ 404 (không trả danh sách rỗng, để màn quản trị không hiện "chưa có ghi
  // chú" cho một đối tượng đã biến mất).
  async list(query: ListAdminNotesQueryDto): Promise<AdminNoteListResponse> {
    await this.assertTargetExists(query.targetType, query.targetId);

    const where = {
      targetType: query.targetType,
      targetId: query.targetId,
    } satisfies Prisma.AdminNoteWhereInput;
    const [total, rows] = await Promise.all([
      this.prisma.adminNote.count({ where }),
      this.prisma.adminNote.findMany({
        where,
        select: adminNoteSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    const names = await this.authorNames(rows.map((row) => row.authorId));
    return {
      items: rows.map((row) =>
        toAdminNote(row, names.get(row.authorId) ?? null),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async create(
    adminId: string,
    input: CreateAdminNoteDto,
  ): Promise<AdminNoteCreatedResponse> {
    await this.assertTargetExists(input.targetType, input.targetId);

    let row: AdminNoteRow;
    try {
      // Không truyền `createdAt`: giờ do đồng hồ DB đóng dấu (xem comment ở schema.prisma).
      row = await this.prisma.adminNote.create({
        data: {
          targetType: input.targetType,
          targetId: input.targetId,
          authorId: adminId,
          content: input.content,
        },
        select: adminNoteSelect,
      });
    } catch (error) {
      throw redactWriteError(error, 'admin note');
    }

    const names = await this.authorNames([adminId]);
    return { note: toAdminNote(row, names.get(adminId) ?? null) };
  }

  // Id sai dạng (kể cả có ký tự NUL mà Postgres không nhận và sẽ thành 500) ra cùng một 404 như id không tồn tại.
  private async assertTargetExists(
    targetType: AdminNoteTargetType,
    targetId: string,
  ): Promise<void> {
    if (!isUuid(targetId)) throw targetNotFound();
    const found =
      targetType === 'USER'
        ? await this.prisma.user.findUnique({
            where: { id: targetId },
            select: { id: true },
          })
        : await this.prisma.shop.findUnique({
            where: { id: targetId },
            select: { id: true },
          });
    if (!found) throw targetNotFound();
  }

  // Tên Admin tra theo lô (một truy vấn cho cả trang). Chỉ lấy `id` và `name` — không bao giờ email hay cột nhạy cảm khác.
  private async authorNames(authorIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(authorIds)];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}
