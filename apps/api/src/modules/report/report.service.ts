import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  parseReportSnapshot,
  type CreateReportResponse,
  type ReportReceipt,
  type ReportTargetType,
} from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { NotificationService } from '../../shared/notification/notification.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { redactWriteError } from '../../shared/utils/redact-write-error';
import type { CreateReportDto } from './dto/create-report.dto';
import { REPORT_DAILY_LIMIT, REPORT_LIMIT_WINDOW_MS } from './report-config';
import {
  REPORT_TARGET_DIRECTORY,
  type ReportTargetDirectory,
} from './report-target-directory';

// Cột của báo cáo mà NGƯỜI BÁO được đọc lại: chỉ đủ để dựng biên nhận. KHÔNG có ghi chú, ảnh chụp, lý do hay kết quả xử lý — người báo
// không có route nào để xem lại báo cáo của mình (kết quả đến qua thông báo chung chung ở bước 5.4).
const receiptSelect = {
  id: true,
  targetType: true,
  status: true,
  createdAt: true,
} satisfies Prisma.ReportSelect;

type ReceiptRow = Prisma.ReportGetPayload<{ select: typeof receiptSelect }>;

// Response dựng bằng object literal tường minh (không spread) để thêm cột vào `receiptSelect` không tự lộ ra ngoài.
export function toReceipt(row: ReceiptRow): ReportReceipt {
  return {
    id: row.id,
    targetType: row.targetType,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

const targetNotFound = () =>
  new AppException(
    404,
    'REPORT_TARGET_NOT_FOUND',
    'The content you are trying to report could not be found',
  );

const ownContent = () =>
  new AppException(
    409,
    'REPORT_OWN_CONTENT',
    'You cannot report your own content',
  );

const alreadyOpen = () =>
  new AppException(
    409,
    'REPORT_ALREADY_OPEN',
    'You already have an open report about this content',
  );

const limitReached = () =>
  new AppException(
    429,
    'REPORT_LIMIT_REACHED',
    'You have sent too many reports recently',
  );

// Lỗi vi phạm unique của CHÍNH bảng `Report` (chỉ mục duy nhất từng phần): soi `meta.modelName` (rules/backend.md mục 4), không so
// câu chữ lỗi.
function isReportUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    (error.meta as { modelName?: string } | undefined)?.modelName === 'Report'
  );
}

// Báo cáo vi phạm — phía NGƯỜI BÁO (Week11.md 5.3, D5). Người báo luôn là người dùng của phiên; đối tượng, ảnh chụp, trạng thái và thời
// điểm do server quyết định — client chỉ gửi loại đối tượng, id, lý do và ghi chú. Phía Admin (hàng đợi + xử lý) ở modules/admin.
//
// Riêng tư: danh tính người báo CHỈ Admin thấy. Module này không có route đọc nào ngoài biên nhận ngay sau khi gửi, bảng `reports` không
// có quan hệ ngược ở `User`, và ghi chú của người báo (văn bản riêng tư) không vào log hay thông báo — thông báo cho Admin chỉ mang id
// báo cáo và loại đối tượng. Lỗi ghi của Prisma (mang nguyên giá trị đã ghi) được che bằng redactWriteError.
@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REPORT_TARGET_DIRECTORY)
    private readonly directory: ReportTargetDirectory,
    private readonly notificationService: NotificationService,
  ) {}

  async create(
    reporterId: string,
    dto: CreateReportDto,
  ): Promise<CreateReportResponse> {
    // 1) Đối tượng có tồn tại và người báo có "thấy" được nó không (hội thoại: có phải thành viên không) — MỘT lỗi 404 cho mọi ca.
    const target = await this.directory.resolve(
      reporterId,
      dto.targetType,
      dto.targetId,
    );
    if (!target) throw targetNotFound();
    // 2) Không tự báo nội dung / shop / sản phẩm của chính mình (kiểm SAU khi đã thấy được đối tượng, để người ngoài không phân biệt
    // được "của người khác" với "không tồn tại").
    if (target.ownedByReporter) throw ownContent();

    const snapshot = this.buildSnapshot(dto.targetType, target.snapshot);

    let row: ReceiptRow;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        // Khoá theo NGƯỜI BÁO đến hết giao dịch: đếm trần và ghi báo cáo của cùng một người được tuần tự hoá, nên gửi song song nhiều
        // báo cáo về nhiều đối tượng khác nhau không vượt được trần (chỉ mục duy nhất chỉ chặn trùng CÙNG đối tượng). Khoá tư vấn
        // (advisory) không khoá hàng nào, người báo khác không bị chặn; hai người trùng mã băm chỉ phải xếp hàng nhau.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`report:${reporterId}`}))`;

        // 3) Đã có báo cáo ĐANG MỞ của chính người này về đối tượng này: báo "đã có" TRƯỚC khi nói chuyện trần, vì đó là câu trả lời
        // đúng cho người đang ở sát trần.
        const open = await tx.report.findFirst({
          where: {
            reporterId,
            targetType: dto.targetType,
            targetId: dto.targetId,
            status: 'OPEN',
          },
          select: { id: true },
        });
        if (open) throw alreadyOpen();

        // 4) Trần báo cáo trong cửa sổ trượt, đếm bằng DB.
        const recent = await tx.report.count({
          where: {
            reporterId,
            createdAt: { gt: new Date(Date.now() - REPORT_LIMIT_WINDOW_MS) },
          },
        });
        if (recent >= REPORT_DAILY_LIMIT) throw limitReached();

        return tx.report.create({
          data: {
            reporterId,
            targetType: dto.targetType,
            targetId: dto.targetId,
            reasonCode: dto.reasonCode,
            note: dto.note ?? null,
            snapshot,
          },
          select: receiptSelect,
        });
      });
    } catch (error) {
      if (error instanceof AppException) throw error;
      // Chỉ mục duy nhất từng phần là trọng tài cuối nếu khoá tư vấn bị đi vòng (vd một đường ghi khác trong tương lai).
      if (isReportUniqueViolation(error)) throw alreadyOpen();
      throw redactWriteError(error, 'report');
    }

    // Chỉ id và loại đối tượng: ghi chú của người báo và người báo không vào log.
    this.logger.log(`Report ${row.id} created for a ${dto.targetType}`);
    // Báo mọi Admin ACTIVE, SAU commit và không bao giờ ném.
    await this.notificationService.notify({
      kind: 'REPORT_SUBMITTED',
      reportId: row.id,
      targetType: dto.targetType,
    });

    return { report: toReceipt(row) };
  }

  // Ảnh chụp sai hình dạng / quá trần là lỗi LẬP TRÌNH của nơi dựng nó (không phải lỗi của người báo): ném lỗi chung. Thông điệp của
  // ZodError có thể nhắc giá trị (vd giá trị enum sai), nên không để nó rơi vào log của bộ lọc lỗi.
  private buildSnapshot(
    targetType: ReportTargetType,
    candidate: unknown,
  ): Prisma.InputJsonObject {
    try {
      return parseReportSnapshot(targetType, candidate);
    } catch {
      throw new Error(`Invalid report snapshot for a ${targetType}`);
    }
  }
}
