import { z } from 'zod';
import { LIST_MAX_PAGE } from './pagination';
import { shopStatusSchema } from './shop';
import { isSafeMessageText } from './text-safety';

// Kháng nghị của chủ shop (Week11.md 4.6, D15): shop bị Admin KHOÁ (SUSPENDED) gửi MỘT lời giải trình cho mỗi lần bị khoá, Admin
// chấp nhận (mở khoá shop) hoặc từ chối (giữ nguyên, không kháng nghị lại được). File này là HỢP ĐỒNG dùng chung của BE và FE
// (schema body/query, hình dạng response và hai hàm thuần quyết định "kháng nghị còn hiệu lực không"); thực thi nằm ở
// `AppealService` (người dùng) và `AdminAppealService` (Admin).

// --- Hằng số ----------------------------------------------------------------------------------------

// Độ dài tối đa của lời kháng nghị và của ghi chú quyết định (ký tự UTF-16). PHẢI khớp CHECK `appeals_message_length_in_range`
// và `appeals_decision_note_length_in_range` (migration `add_appeals_table`): `appeal-schemas.spec.ts` đọc file migration và
// so cận trên. Zod đếm đơn vị UTF-16 còn `char_length` đếm ký tự ⇒ Zod luôn chặt hơn hoặc bằng DB.
export const APPEAL_MESSAGE_MAX_LENGTH = 1000;
export const APPEAL_DECISION_NOTE_MAX_LENGTH = 500;
// Số kháng nghị tối đa mỗi trang ở hàng đợi của Admin, và số kháng nghị gần nhất chủ shop thấy ở lịch sử của mình.
export const APPEAL_LIST_MAX_PAGE_SIZE = 50;
export const APPEAL_OWNER_HISTORY_LIMIT = 20;

// Trạng thái shop DUY NHẤT được kháng nghị. Shop bị TỪ CHỐI (REJECTED) không kháng nghị: chủ shop tự sửa rồi nộp lại được
// (`POST /shops/:shopId/resubmit`), nên kháng nghị chỉ là thêm một bước; shop bị khoá theo cascade tài khoản cũng không (chủ
// tài khoản bị khoá không đăng nhập được — đường duy nhất là `SUPPORT_EMAIL`).
export const APPEALABLE_SHOP_STATUS = 'SUSPENDED' as const;

// --- Đối tượng và trạng thái ------------------------------------------------------------------------

// Loại đối tượng được kháng nghị. Khớp enum Prisma `AppealTargetType` (test parity ở BE). `PRODUCT` đã có sẵn để bước kháng nghị
// sản phẩm bị gỡ (Week11.md 5.8) không cần migration thêm; đến lúc đó API vẫn chỉ nhận `SHOP`.
export const APPEAL_TARGET_TYPES = ['SHOP', 'PRODUCT'] as const;
export const appealTargetTypeSchema = z.enum(APPEAL_TARGET_TYPES);
export type AppealTargetType = z.infer<typeof appealTargetTypeSchema>;

// Trạng thái LƯU trong DB. Khớp enum Prisma `AppealStatus`.
export const APPEAL_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;
export const appealStatusSchema = z.enum(APPEAL_STATUSES);
export type AppealStatus = z.infer<typeof appealStatusSchema>;

// Trạng thái HIỂN THỊ = trạng thái lưu + `CLOSED`: kháng nghị còn PENDING nhưng lần khoá mà nó nhắm tới đã kết thúc (shop được
// mở khoá bằng đường khác, hoặc bị khoá lại một lần khác). SUY RA lúc đọc, không ghi vào DB — các luồng đổi trạng thái shop
// sẵn có không phải biết tới kháng nghị.
export const APPEAL_STATES = ['PENDING', 'ACCEPTED', 'REJECTED', 'CLOSED'] as const;
export const appealStateSchema = z.enum(APPEAL_STATES);
export type AppealState = z.infer<typeof appealStateSchema>;

// Lần khoá mà kháng nghị nhắm tới còn đang diễn ra không: shop vẫn SUSPENDED và mốc đổi trạng thái vẫn đúng mốc lúc kháng nghị
// được gửi (`moderationEventAt` = `Shop.statusChangedAt` của lần khoá đó). Mốc đổi ⇒ shop đã được mở rồi bị khoá lại: đó là một
// lần khoá KHÁC, có quyền kháng nghị riêng.
export function isAppealEpisodeCurrent(
  shop: { status: string; statusChangedAt: Date | string },
  moderationEventAt: Date | string,
): boolean {
  return (
    shop.status === APPEALABLE_SHOP_STATUS &&
    new Date(shop.statusChangedAt).getTime() === new Date(moderationEventAt).getTime()
  );
}

export function deriveAppealState(status: AppealStatus, isEpisodeCurrent: boolean): AppealState {
  if (status !== 'PENDING') return status;
  return isEpisodeCurrent ? 'PENDING' : 'CLOSED';
}

// --- Request ----------------------------------------------------------------------------------------

// Cùng cách chuẩn hoá của ghi chú Admin và tin nhắn chat: `\r\n`/`\r` → `\n`, cắt khoảng trắng hai đầu, rồi kiểm độ dài và ký
// tự (chặn NUL, điều khiển, bidi-override, BOM, dấu phân dòng Unicode). Không chặn `<` `>`: nội dung hiển thị nguyên văn như chữ
// (React tự escape). Thông điệp lỗi là KEY i18n như mọi schema dùng chung.
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

export const appealMessageSchema = plainText(APPEAL_MESSAGE_MAX_LENGTH, {
  required: 'appeal.validationMessageRequired',
  tooLong: 'appeal.validationMessageTooLong',
  unsafe: 'appeal.validationMessageUnsafe',
});

export const appealDecisionNoteSchema = plainText(APPEAL_DECISION_NOTE_MAX_LENGTH, {
  required: 'admin.validationAppealNoteRequired',
  tooLong: 'admin.validationAppealNoteTooLong',
  unsafe: 'admin.validationAppealNoteUnsafe',
});

// POST /shops/:shopId/appeals — người gửi, đối tượng và mốc bị xử lý KHÔNG nằm trong body: người gửi lấy từ phiên, shop từ đường
// dẫn (đã qua ShopOwnerGuard), mốc từ `Shop.statusChangedAt` ở server. Client không đặt được.
export const createAppealSchema = z.object({
  message: appealMessageSchema,
});
export type CreateAppealInput = z.infer<typeof createAppealSchema>;

export const APPEAL_DECISIONS = ['ACCEPT', 'REJECT'] as const;
export const appealDecisionSchema = z.enum(APPEAL_DECISIONS);
export type AppealDecision = z.infer<typeof appealDecisionSchema>;

// Ghi chú tuỳ chọn: ô nhập HTML bỏ trống gửi lên "" (hoặc toàn khoảng trắng) và phải coi như CHƯA NHẬP — cùng quy ước `optionalText` — để
// form dùng thẳng được schema này (rules/frontend.md mục 4). Có nội dung thì qua đầy đủ luật của `appealDecisionNoteSchema`. `transform` đặt
// ở cuối chuỗi nên input và output cùng kiểu `string | undefined` (khớp generic `useForm<T>` của zodResolver).
const optionalDecisionNote = z
  .string()
  .transform((value) => (value.trim() === '' ? undefined : value))
  .pipe(appealDecisionNoteSchema.optional())
  .optional();

// POST /admin/appeals/:id/decide. Từ chối BẮT BUỘC có lý do (chủ shop đọc được lý do này); chấp nhận thì ghi chú là tuỳ chọn.
export const decideAppealSchema = z
  .object({
    decision: appealDecisionSchema,
    note: optionalDecisionNote,
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'REJECT' && value.note === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'admin.validationAppealNoteRequired',
      });
    }
  });
export type DecideAppealInput = z.infer<typeof decideAppealSchema>;

// GET /admin/appeals. Query param qua URL luôn là string — coerce number cho page/limit (rules/backend.md mục 2). `CLOSED` là
// kháng nghị còn PENDING nhưng lần khoá đã kết thúc (xem APPEAL_STATES): có bộ lọc riêng để Admin vẫn xem lại được.
export const ADMIN_APPEAL_LIST_FILTERS = ['PENDING', 'ACCEPTED', 'REJECTED', 'CLOSED'] as const;
export const adminAppealListFilterSchema = z.enum(ADMIN_APPEAL_LIST_FILTERS);
export type AdminAppealListFilter = z.infer<typeof adminAppealListFilterSchema>;

export const adminAppealListQuerySchema = z.object({
  status: adminAppealListFilterSchema.default('PENDING'),
  page: z.coerce.number().int().positive().max(LIST_MAX_PAGE).default(1),
  limit: z.coerce.number().int().positive().max(APPEAL_LIST_MAX_PAGE_SIZE).default(20),
});
export type AdminAppealListQuery = z.infer<typeof adminAppealListQuerySchema>;

// --- Response (allowlist) ---------------------------------------------------------------------------

// Một kháng nghị như CHỦ SHOP thấy. Không có id người quyết định hay tên Admin: người kháng nghị chỉ biết "sàn" đã quyết.
export const ownerAppealSchema = z.object({
  id: z.string(),
  state: appealStateSchema,
  message: z.string(),
  decisionNote: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  // Mốc lần khoá mà kháng nghị nhắm tới — để FE nhóm/so với `statusChangedAt` của shop nếu cần.
  moderationEventAt: z.string(),
});
export type OwnerAppeal = z.infer<typeof ownerAppealSchema>;

// GET /shops/:shopId/appeals: lịch sử kháng nghị của chính shop (mới nhất trước) và `canAppeal` do SERVER tính (đúng luật của
// POST) để FE không tự suy lại luật: shop đang SUSPENDED, không phải khoá cascade, và lần khoá này chưa có kháng nghị nào.
export const shopAppealsResponseSchema = z.object({
  appeals: z.array(ownerAppealSchema),
  canAppeal: z.boolean(),
});
export type ShopAppealsResponse = z.infer<typeof shopAppealsResponseSchema>;

// Một kháng nghị như ADMIN thấy ở hàng đợi: kèm shop và chủ shop để quyết định mà không phải mở trang khác. Có email chủ shop
// (Admin được thấy, như danh sách shop), không có SĐT hay địa chỉ.
export const adminAppealSchema = z.object({
  id: z.string(),
  state: appealStateSchema,
  message: z.string(),
  decisionNote: z.string().nullable(),
  decidedByName: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  moderationEventAt: z.string(),
  shop: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    logoUrl: z.string().nullable(),
    status: shopStatusSchema,
    statusReason: z.string().nullable(),
  }),
  owner: z.object({ name: z.string(), email: z.string() }),
});
export type AdminAppeal = z.infer<typeof adminAppealSchema>;

export const adminAppealListResponseSchema = z.object({
  items: z.array(adminAppealSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type AdminAppealListResponse = z.infer<typeof adminAppealListResponseSchema>;

// Response của POST /admin/appeals/:id/decide: kháng nghị sau khi quyết định (cùng hình dạng một dòng hàng đợi).
export const decideAppealResponseSchema = z.object({ appeal: adminAppealSchema });
export type DecideAppealResponse = z.infer<typeof decideAppealResponseSchema>;
