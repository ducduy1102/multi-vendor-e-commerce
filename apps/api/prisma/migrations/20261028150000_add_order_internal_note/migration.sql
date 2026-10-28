-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "internal_note" VARCHAR(500);

-- Ghi chú nội bộ của shop trên đơn (Week11.md 4.4): NULL (không có ghi chú) hoặc 1..500 ký tự — chuỗi rỗng KHÔNG hợp lệ (xoá ghi chú
-- = NULL), cùng quy ước với `buyer_note`. VARCHAR(500) đã chặn quá dài; CHECK này chặn thêm chuỗi rỗng và là lưới an toàn cuối cho
-- mọi đường ghi vòng qua OrderInternalNoteService (service vẫn kiểm bằng Zod trước khi ghi). Cận trên phải khớp
-- ORDER_INTERNAL_NOTE_MAX_LENGTH ở packages/types (order-internal-note-schemas.spec.ts đọc file này và so cận trên).
ALTER TABLE "orders" ADD CONSTRAINT "orders_internal_note_length_in_range" CHECK ("internal_note" IS NULL OR char_length("internal_note") BETWEEN 1 AND 500);
