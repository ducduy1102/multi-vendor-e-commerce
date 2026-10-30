import { z } from 'zod';
import { LIST_MAX_PAGE } from './pagination';
import { isSafeMessageText, utf8ByteLength } from './text-safety';

// Báo cáo vi phạm (Week11.md 5.1, D5): người dùng đã đăng nhập báo một ĐÁNH GIÁ, HỘI THOẠI, SHOP hoặc SẢN PHẨM; Admin xem hàng
// đợi, chọn một hành động theo loại (ẩn đánh giá, khoá shop, gỡ sản phẩm, khoá người dùng, chặn người mua) hoặc bỏ qua. File này là
// HỢP ĐỒNG dùng chung của BE và FE (schema body/query, hình dạng response, bảng "loại ↔ lý do ↔ hành động" và các hàm thuần kiểm
// bảng đó); thực thi nằm ở module `report` (phía người báo) và `AdminReportsService` (phía Admin).
//
// Bất biến riêng tư của cả tính năng (mọi nơi dùng hợp đồng này phải giữ):
//   - Người bị báo KHÔNG có response nào mang danh tính người báo: không có schema phía chủ shop/tác giả trong file này, và các
//     schema Admin dưới đây không được dùng ở bất kỳ route nào ngoài `/admin/*`.
//   - Ảnh chụp (snapshot) của HỘI THOẠI tuyệt đối không có nội dung tin nhắn: Admin chỉ đọc chat qua đường có nhật ký truy cập,
//     ghi nhật ký TRƯỚC khi trả dữ liệu (Week11.md D7, bước 6.1). Chép nội dung vào ảnh chụp sẽ mở đường đọc chat không để lại dấu vết.

// --- Hằng số ----------------------------------------------------------------------------------------

// Độ dài tối đa (ký tự UTF-16) của ghi chú người báo và ghi chú xử lý của Admin. PHẢI khớp CHECK `reports_note_length_in_range` và
// `reports_resolution_note_length_in_range` (migration `add_reports_table`, bước 5.2): `report-schemas.spec.ts` đọc file migration
// và so cận trên. Zod đếm đơn vị UTF-16 còn `char_length` đếm ký tự ⇒ Zod luôn chặt hơn hoặc bằng DB.
export const REPORT_NOTE_MAX_LENGTH = 500;
export const REPORT_RESOLUTION_NOTE_MAX_LENGTH = 500;
// Ảnh chụp tối đa tính bằng BYTE UTF-8 của JSON gọn. 4 KB (không phải 2 KB như bản nháp kế hoạch) vì một đánh giá dài tối đa 1.000 ký
// tự tiếng Việt đã tới ~3.000 byte — ảnh chụp lưu NGUYÊN VĂN câu bị báo (bằng chứng, vì tác giả sửa được một lần sau khi bị báo) chứ
// không cắt cụt. DB giữ lưới an toàn nới gấp đôi (CHECK `reports_snapshot_size_limit` = 8192 byte văn bản jsonb, vì jsonb::text chèn
// thêm dấu cách) — cùng cách `notifications.data` và `admin_audit_logs.meta`.
export const REPORT_SNAPSHOT_MAX_BYTES = 4096;
// Tên (shop, sản phẩm, người dùng) trong ảnh chụp bị cắt ở độ dài này trước khi ghi; tên shop và tên người dùng vốn đã ≤ 100.
export const REPORT_SNAPSHOT_NAME_MAX_LENGTH = 150;
// Số báo cáo tối đa mỗi trang ở hàng đợi của Admin.
export const REPORT_LIST_MAX_PAGE_SIZE = 50;

// --- Đối tượng, lý do, trạng thái ---------------------------------------------------------------------

// Loại đối tượng bị báo. Khớp enum Prisma `ReportTargetType` (test parity ở BE) và tập con của `ADMIN_AUDIT_TARGET_TYPES`.
export const REPORT_TARGET_TYPES = ['REVIEW', 'CONVERSATION', 'SHOP', 'PRODUCT'] as const;
export const reportTargetTypeSchema = z.enum(REPORT_TARGET_TYPES);
export type ReportTargetType = z.infer<typeof reportTargetTypeSchema>;

// Trạng thái LƯU trong DB. Khớp enum Prisma `ReportStatus`. `OPEN → RESOLVED` (Admin đã chọn một hành động xử lý) hoặc
// `OPEN → DISMISSED` (Admin kết luận không vi phạm); không có cạnh đi ra khỏi hai trạng thái sau.
export const REPORT_STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED'] as const;
export const reportStatusSchema = z.enum(REPORT_STATUSES);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

// Mã lý do là chuỗi kiểm bằng Zod chứ KHÔNG phải enum DB, để thêm mã không cần migration; nhãn dịch ở FE (namespace `report`). Mỗi loại
// đối tượng chỉ nhận một tập con — FE dựng <select> từ REPORT_REASON_CODES_BY_TARGET, BE kiểm lại bằng isReportReasonAllowedForTarget.
// Mã dùng chung giữa các loại khi nghĩa giống nhau (SPAM, SCAM, COUNTERFEIT...) để thống kê theo mã sau này không phải gộp lại.
export const REPORT_REASON_CODES = [
  'SPAM',
  'OFFENSIVE_LANGUAGE',
  'FAKE_REVIEW',
  'PERSONAL_INFO',
  'IRRELEVANT',
  'HARASSMENT',
  'SCAM',
  'COUNTERFEIT',
  'PROHIBITED_ITEM',
  'MISLEADING_INFO',
  'OFFENSIVE_CONTENT',
  'OTHER',
] as const;
export type ReportReasonCode = (typeof REPORT_REASON_CODES)[number];

export const REPORT_REASON_CODES_BY_TARGET = {
  REVIEW: ['SPAM', 'OFFENSIVE_LANGUAGE', 'FAKE_REVIEW', 'PERSONAL_INFO', 'IRRELEVANT', 'OTHER'],
  CONVERSATION: ['HARASSMENT', 'SPAM', 'SCAM', 'PERSONAL_INFO', 'OFFENSIVE_LANGUAGE', 'OTHER'],
  SHOP: ['COUNTERFEIT', 'SCAM', 'PROHIBITED_ITEM', 'MISLEADING_INFO', 'HARASSMENT', 'OTHER'],
  PRODUCT: ['PROHIBITED_ITEM', 'COUNTERFEIT', 'MISLEADING_INFO', 'OFFENSIVE_CONTENT', 'OTHER'],
} as const satisfies Record<ReportTargetType, readonly ReportReasonCode[]>;

export function isReportReasonAllowedForTarget(
  targetType: ReportTargetType,
  code: ReportReasonCode,
): boolean {
  return (REPORT_REASON_CODES_BY_TARGET[targetType] as readonly ReportReasonCode[]).includes(code);
}

// Thiếu và sai giá trị cùng 1 errorMap vì zod không cho trộn `errorMap` với required_error/invalid_type_error.
export const reportReasonCodeSchema = z.enum(REPORT_REASON_CODES, {
  errorMap: (issue, ctx) => ({
    message:
      issue.code === 'invalid_type' && ctx.data === undefined
        ? 'report.validationReasonRequired'
        : 'report.validationReasonInvalid',
  }),
});

// --- Hành động xử lý của Admin ------------------------------------------------------------------------

// Hành động Admin chọn khi xử lý. Mỗi hành động gọi lại đúng service sẵn có trong CÙNG transaction đóng báo cáo (bước 5.4):
//   HIDE_REVIEW            ẩn đánh giá (5.5)                  SUSPEND_SHOP        khoá shop qua ShopStatusService (actor ADMIN)
//   TAKE_DOWN_PRODUCT      gỡ sản phẩm (5.7)                  SUSPEND_REPORTED_USER  khoá tài khoản bên bị báo (3.3)
//   BLOCK_BUYER            chặn người mua theo shop (6.2)     DISMISS             không vi phạm, không làm gì thêm
export const REPORT_RESOLUTION_ACTIONS = [
  'HIDE_REVIEW',
  'SUSPEND_SHOP',
  'TAKE_DOWN_PRODUCT',
  'SUSPEND_REPORTED_USER',
  'BLOCK_BUYER',
  'DISMISS',
] as const;
export const reportResolutionActionSchema = z.enum(REPORT_RESOLUTION_ACTIONS);
export type ReportResolutionAction = z.infer<typeof reportResolutionActionSchema>;

export const REPORT_RESOLUTION_ACTIONS_BY_TARGET = {
  REVIEW: ['HIDE_REVIEW', 'DISMISS'],
  SHOP: ['SUSPEND_SHOP', 'DISMISS'],
  PRODUCT: ['TAKE_DOWN_PRODUCT', 'DISMISS'],
  CONVERSATION: ['SUSPEND_REPORTED_USER', 'BLOCK_BUYER', 'DISMISS'],
} as const satisfies Record<ReportTargetType, readonly ReportResolutionAction[]>;

// Ai báo hội thoại: người mua hay chủ shop. Hội thoại luôn có đúng hai bên nên bên bị báo là bên còn lại — `BUYER` báo ⇒ bên bị
// báo là chủ shop, `SHOP` báo ⇒ bên bị báo là người mua. Cùng từ vựng `viewerRole` của chat.
export const REPORT_CONVERSATION_REPORTER_ROLES = ['BUYER', 'SHOP'] as const;
export const reportConversationReporterRoleSchema = z.enum(REPORT_CONVERSATION_REPORTER_ROLES);
export type ReportConversationReporterRole = z.infer<typeof reportConversationReporterRoleSchema>;

// Hành động `action` có dùng được cho một báo cáo loại `targetType` không. `BLOCK_BUYER` còn phụ thuộc bên bị báo: chỉ có nghĩa khi bên
// bị báo là NGƯỜI MUA (chủ shop báo ⇒ `conversationReporterRole = 'SHOP'`); người mua báo shop thì không có "người mua nào để chặn".
// BE kiểm lại bằng hàm này khi xử lý (không tin nút bấm ở FE); FE dùng `reportActionsFor` để vẽ đúng các nút.
export function isReportActionAllowed(
  targetType: ReportTargetType,
  action: ReportResolutionAction,
  conversationReporterRole?: ReportConversationReporterRole,
): boolean {
  if (!(REPORT_RESOLUTION_ACTIONS_BY_TARGET[targetType] as readonly string[]).includes(action)) {
    return false;
  }
  if (action === 'BLOCK_BUYER') return conversationReporterRole === 'SHOP';
  return true;
}

export function reportActionsFor(
  targetType: ReportTargetType,
  conversationReporterRole?: ReportConversationReporterRole,
): ReportResolutionAction[] {
  return REPORT_RESOLUTION_ACTIONS_BY_TARGET[targetType].filter((action) =>
    isReportActionAllowed(targetType, action, conversationReporterRole),
  );
}

// Trạng thái cuối của báo cáo sau khi Admin chọn `action`: bỏ qua ⇒ DISMISSED, mọi hành động xử lý khác ⇒ RESOLVED.
export function reportStatusForAction(action: ReportResolutionAction): 'RESOLVED' | 'DISMISSED' {
  return action === 'DISMISS' ? 'DISMISSED' : 'RESOLVED';
}

// Mọi hành động trừ DISMISS đều ĐỘNG TỚI một đối tượng (ẩn, khoá, gỡ, chặn) nên Admin phải ghi lý do — lý do vào nhật ký quản trị và vào
// cột lý do của chính hành động đó. DISMISS thì ghi chú tuỳ chọn (chỉ để Admin khác hiểu vì sao bỏ qua).
export function reportActionRequiresNote(action: ReportResolutionAction): boolean {
  return action !== 'DISMISS';
}

// --- Request ----------------------------------------------------------------------------------------

// Cùng cách chuẩn hoá của ghi chú kháng nghị và tin nhắn chat: `\r\n`/`\r` → `\n`, cắt khoảng trắng hai đầu, rồi kiểm độ dài và ký
// tự (chặn NUL, điều khiển, bidi-override, BOM, dấu phân dòng Unicode). Không chặn `<` `>`: nội dung hiển thị nguyên văn như chữ (React
// tự escape). Thông điệp lỗi là KEY i18n như mọi schema dùng chung.
const plainText = (
  maxLength: number,
  keys: { required: string; tooLong: string; unsafe: string },
) =>
  z
    .string({ required_error: keys.required, invalid_type_error: keys.required })
    .transform((value) => value.replace(/\r\n?/g, '\n'))
    .pipe(
      z
        .string()
        .trim()
        .min(1, keys.required)
        .max(maxLength, keys.tooLong)
        .refine(isSafeMessageText, keys.unsafe),
    );

// Ô nhập HTML bỏ trống gửi lên "" (hoặc toàn khoảng trắng) và phải coi như CHƯA NHẬP — cùng quy ước `optionalText` — để form dùng thẳng
// được schema này (rules/frontend.md mục 4). Có nội dung thì qua đầy đủ luật của `schema`. `transform` đặt ở đầu chuỗi nhưng `pipe` đưa
// kết quả về `string | undefined` nên input và output cùng kiểu (khớp generic `useForm<T>` của zodResolver).
const optionalPlainText = (schema: ReturnType<typeof plainText>) =>
  z
    .string()
    .transform((value) => (value.trim() === '' ? undefined : value))
    .pipe(schema.optional())
    .optional();

export const reportNoteSchema = plainText(REPORT_NOTE_MAX_LENGTH, {
  required: 'report.validationNoteRequired',
  tooLong: 'report.validationNoteTooLong',
  unsafe: 'report.validationNoteUnsafe',
});

export const reportResolutionNoteSchema = plainText(REPORT_RESOLUTION_NOTE_MAX_LENGTH, {
  required: 'admin.validationReportNoteRequired',
  tooLong: 'admin.validationReportNoteTooLong',
  unsafe: 'admin.validationReportNoteUnsafe',
});

// POST /reports — người báo lấy từ phiên; trạng thái, ảnh chụp, thời điểm và người xử lý KHÔNG nằm trong body (field lạ bị bỏ khi parse).
// `targetType`/`targetId` không phải ô người dùng nhập (FE điền sẵn từ nút "Báo cáo") nên không có thông điệp i18n riêng; điều kiện nghiệp
// vụ (đối tượng tồn tại và công khai với người báo, không phải của chính mình, hội thoại chỉ hai thành viên) do BE kiểm.
// Hai luật chéo: lý do phải thuộc đúng loại đối tượng, và chọn `OTHER` thì BẮT BUỘC mô tả (Admin không có gì để xét nếu cả lý do lẫn mô tả
// đều trống). `superRefine` đặt SAU object nên input/output type của form vẫn là { targetType, targetId, reasonCode, note? }.
export const createReportSchema = z
  .object({
    targetType: reportTargetTypeSchema,
    targetId: z.string().uuid(),
    reasonCode: reportReasonCodeSchema,
    note: optionalPlainText(reportNoteSchema),
  })
  .superRefine((value, ctx) => {
    if (!isReportReasonAllowedForTarget(value.targetType, value.reasonCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasonCode'],
        message: 'report.validationReasonInvalid',
      });
    }
    if (value.reasonCode === 'OTHER' && value.note === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'report.validationNoteRequired',
      });
    }
  });
export type CreateReportInput = z.infer<typeof createReportSchema>;

// POST /admin/reports/:id/resolve. Đối tượng và người xử lý KHÔNG nằm trong body: đối tượng suy ra từ báo cáo trong DB, người xử lý từ
// phiên. Hành động có hợp lệ với LOẠI của báo cáo này không là việc của service (cần đọc báo cáo) — schema chỉ kiểm hành động thuộc tập
// đã biết và luật ghi chú.
export const resolveReportSchema = z
  .object({
    action: reportResolutionActionSchema,
    note: optionalPlainText(reportResolutionNoteSchema),
  })
  .superRefine((value, ctx) => {
    if (reportActionRequiresNote(value.action) && value.note === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'admin.validationReportNoteRequired',
      });
    }
  });
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;

// GET /admin/reports. Query param qua URL luôn là string — coerce number cho page/limit (rules/backend.md mục 2). Hai tab của hàng đợi:
// `OPEN` (chờ xử lý) và `CLOSED` (đã xử lý = RESOLVED + DISMISSED; mỗi dòng tự mang kết quả của nó). Bỏ trống `targetType` = mọi loại.
export const ADMIN_REPORT_LIST_FILTERS = ['OPEN', 'CLOSED'] as const;
export const adminReportListFilterSchema = z.enum(ADMIN_REPORT_LIST_FILTERS);
export type AdminReportListFilter = z.infer<typeof adminReportListFilterSchema>;

export const adminReportListQuerySchema = z.object({
  status: adminReportListFilterSchema.default('OPEN'),
  targetType: reportTargetTypeSchema.optional(),
  page: z.coerce.number().int().positive().max(LIST_MAX_PAGE).default(1),
  limit: z.coerce.number().int().positive().max(REPORT_LIST_MAX_PAGE_SIZE).default(20),
});
export type AdminReportListQuery = z.infer<typeof adminReportListQuerySchema>;

// --- Ảnh chụp (snapshot) ----------------------------------------------------------------------------

// Vài trường cần để Admin quyết định, CHỤP LẠI lúc báo vì đối tượng có thể bị sửa sau đó (đánh giá sửa được một lần, shop đổi tên...). KHÔNG
// có id người báo, email, SĐT, địa chỉ hay bất kỳ nội dung chat nào. Id của đối tượng nằm ở `targetId` của báo cáo, không lặp lại ở đây.
// Mỗi hình dạng là object THƯỜNG (response bỏ field lạ như mọi schema khác); phía GHI dùng `parseReportSnapshot` bên dưới, bản này ép
// `.strict()` + trần byte để một lỗi của nơi dựng ảnh chụp không bao giờ ghi thêm trường vào DB.
const snapshotName = z.string().min(1).max(REPORT_SNAPSHOT_NAME_MAX_LENGTH);
const snapshotSlug = z.string().min(1).max(REPORT_SNAPSHOT_NAME_MAX_LENGTH);

export const reviewReportSnapshotSchema = z.object({
  productName: snapshotName,
  productSlug: snapshotSlug,
  rating: z.number().int().min(1).max(5),
  // Nguyên văn đánh giá lúc bị báo (≤ REVIEW_COMMENT_MAX_LENGTH ký tự); null khi đánh giá chỉ có sao.
  comment: z.string().nullable(),
  // Tên đầy đủ của tác giả — Admin được thấy (khác trang công khai che tên).
  authorName: snapshotName,
});
export type ReviewReportSnapshot = z.infer<typeof reviewReportSnapshotSchema>;

export const shopReportSnapshotSchema = z.object({
  name: snapshotName,
  slug: snapshotSlug,
});
export type ShopReportSnapshot = z.infer<typeof shopReportSnapshotSchema>;

export const productReportSnapshotSchema = z.object({
  name: snapshotName,
  slug: snapshotSlug,
  shopName: snapshotName,
});
export type ProductReportSnapshot = z.infer<typeof productReportSnapshotSchema>;

// CHỈ tên hai bên và vai của người báo. Không có nội dung tin, không có thời điểm tin cuối, không có số tin (xem bất biến ở đầu file).
export const conversationReportSnapshotSchema = z.object({
  shopName: snapshotName,
  buyerName: snapshotName,
  reporterRole: reportConversationReporterRoleSchema,
});
export type ConversationReportSnapshot = z.infer<typeof conversationReportSnapshotSchema>;

export const REPORT_SNAPSHOT_SCHEMAS = {
  REVIEW: reviewReportSnapshotSchema,
  CONVERSATION: conversationReportSnapshotSchema,
  SHOP: shopReportSnapshotSchema,
  PRODUCT: productReportSnapshotSchema,
} as const satisfies Record<ReportTargetType, z.ZodObject<z.ZodRawShape>>;

// Kiểm một ảnh chụp trước khi GHI vào DB: đúng hình dạng của loại, KHÔNG field thừa, tổng ≤ REPORT_SNAPSHOT_MAX_BYTES. Ném ZodError khi
// sai — nơi gọi (module `report`, bước 5.3) để lỗi này thành 500 chứ không lặng lẽ bỏ trường: ảnh chụp sai là lỗi lập trình, không phải
// lỗi của người dùng. Thông điệp lỗi chỉ có đường dẫn trường và mã Zod, không có giá trị (đánh giá/tên là dữ liệu riêng tư).
// Kiểu kết quả theo loại: nơi gọi truyền literal `'REVIEW'` thì nhận `ReviewReportSnapshot`.
export interface ReportSnapshotByTarget {
  REVIEW: ReviewReportSnapshot;
  CONVERSATION: ConversationReportSnapshot;
  SHOP: ShopReportSnapshot;
  PRODUCT: ProductReportSnapshot;
}

export function parseReportSnapshot<T extends ReportTargetType>(
  targetType: T,
  value: unknown,
): ReportSnapshotByTarget[T] {
  const snapshot = REPORT_SNAPSHOT_SCHEMAS[targetType].strict().parse(value);
  if (utf8ByteLength(JSON.stringify(snapshot)) > REPORT_SNAPSHOT_MAX_BYTES) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: [],
        message: `report snapshot exceeds ${REPORT_SNAPSHOT_MAX_BYTES} bytes`,
      },
    ]);
  }
  return snapshot as ReportSnapshotByTarget[T];
}

// --- Response ---------------------------------------------------------------------------------------

// Biên nhận người báo nhận được sau POST /reports: chỉ đủ để FE hiện "Đã gửi báo cáo". Không echo lại ghi chú, ảnh chụp hay thông tin
// đối tượng — và người báo không có route nào để xem lại báo cáo của mình (kết quả đến qua thông báo chung chung).
export const reportReceiptSchema = z.object({
  id: z.string(),
  targetType: reportTargetTypeSchema,
  status: reportStatusSchema,
  createdAt: z.string(),
});
export type ReportReceipt = z.infer<typeof reportReceiptSchema>;

export const createReportResponseSchema = z.object({ report: reportReceiptSchema });
export type CreateReportResponse = z.infer<typeof createReportResponseSchema>;

// Kết quả xử lý (null khi báo cáo còn OPEN). `action` là chuỗi chứ không phải enum để một hành động mà FE chưa biết (hoặc đã bị bỏ) không
// làm hỏng cả danh sách — FE rơi về nhãn chung. `resolvedByName` null khi tài khoản Admin đã bị xoá.
export const reportResolutionSchema = z.object({
  action: z.string(),
  note: z.string().nullable(),
  resolvedByName: z.string().nullable(),
  resolvedAt: z.string(),
});
export type ReportResolution = z.infer<typeof reportResolutionSchema>;

// Người báo như ADMIN thấy (để nhận ra tài khoản báo bừa). Có email như danh sách kháng nghị, không có SĐT hay địa chỉ.
const reportReporterSchema = z.object({ name: z.string(), email: z.string() });

// `reasonCode` là chuỗi thường (không enum): mã lạ do BE thêm sau thì FE rơi về nhãn chung thay vì parse hỏng cả trang (cùng
// `buyerRefundRequestSchema`).
const adminReportBaseShape = {
  id: z.string(),
  targetId: z.string(),
  status: reportStatusSchema,
  reasonCode: z.string(),
  note: z.string().nullable(),
  reporter: reportReporterSchema,
  createdAt: z.string(),
  resolution: reportResolutionSchema.nullable(),
};

// Một báo cáo như ADMIN thấy, phân biệt theo `targetType` để `snapshot` có đúng kiểu của loại đó.
export const adminReportSchema = z.discriminatedUnion('targetType', [
  z.object({
    ...adminReportBaseShape,
    targetType: z.literal('REVIEW'),
    snapshot: reviewReportSnapshotSchema,
  }),
  z.object({
    ...adminReportBaseShape,
    targetType: z.literal('CONVERSATION'),
    snapshot: conversationReportSnapshotSchema,
  }),
  z.object({
    ...adminReportBaseShape,
    targetType: z.literal('SHOP'),
    snapshot: shopReportSnapshotSchema,
  }),
  z.object({
    ...adminReportBaseShape,
    targetType: z.literal('PRODUCT'),
    snapshot: productReportSnapshotSchema,
  }),
]);
export type AdminReport = z.infer<typeof adminReportSchema>;

export const adminReportListResponseSchema = z.object({
  items: z.array(adminReportSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type AdminReportListResponse = z.infer<typeof adminReportListResponseSchema>;

// Response của GET /admin/reports/:id và POST /admin/reports/:id/resolve: báo cáo (sau khi xử lý, với POST) cùng hình dạng một dòng hàng
// đợi để màn quản trị cập nhật tại chỗ.
export const adminReportDetailResponseSchema = z.object({ report: adminReportSchema });
export type AdminReportDetailResponse = z.infer<typeof adminReportDetailResponseSchema>;
