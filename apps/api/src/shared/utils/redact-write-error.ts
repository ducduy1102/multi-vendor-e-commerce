import { Prisma } from '@prisma/client';

// Che lỗi của câu GHI dữ liệu riêng tư (tin nhắn, lý do khoá, nhật ký quản trị, ghi chú nội bộ, nội dung báo cáo...) TRƯỚC khi
// lan ra ngoài. AllExceptionsFilter log toàn bộ `stack` của mọi lỗi không phải HttpException, và hai nhóm lỗi Prisma IN
// NGUYÊN giá trị đã ghi vào message/stack (đã đo trên Postgres thật, Week11.md 2.4):
//   1. `PrismaClientValidationError` — in cả đoạn gọi kèm toàn bộ `data` (lỗi lập trình: quên trường, sai kiểu...);
//   2. lỗi request mang `DETAIL` của Postgres — vi phạm CHECK in "Failing row contains (…toàn bộ hàng…)", và với câu SQL thô
//      còn in cả khoá vi phạm ("Key (email)=(…) already exists"). Hiện ở dạng `PrismaClientUnknownRequestError`
//      (`detail: Some("…")`) khi ghi bằng API model và `PrismaClientKnownRequestError` P2010 (`DETAIL: …`) khi ghi SQL thô.
// Lỗi KHÔNG mang giá trị — P2002/P2003 của model API, lỗi trigger (`RAISE EXCEPTION` không kèm DETAIL), DB sập, kết nối đứt —
// được ném NGUYÊN để không mất thông tin chẩn đoán (và để nơi gọi còn bắt được mã lỗi như P2002).
//
// Thay bằng một lỗi chung KHÔNG mang dữ liệu, KHÔNG gắn `cause` (cause sẽ được in cùng stack). Giữ lại những gì an toàn và
// hữu ích để chẩn đoán: tên lớp lỗi, mã Prisma và TÊN ràng buộc (lấy từ schema DB nên không thể là dữ liệu người dùng; chỉ
// nhận ký tự chữ-số-gạch dưới).
//
// Cách dùng: `catch (error) { throw redactWriteError(error, 'chat message'); }` — `description` là cụm danh từ ngắn, cố
// định, KHÔNG nội suy dữ liệu.
export function redactWriteError(error: unknown, description: string): unknown {
  if (!(error instanceof Error) || !carriesWrittenValues(error)) return error;

  const parts = [error.constructor.name];
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^P\d{4}$/.test(code)) parts.push(code);
  const constraint = CONSTRAINT_NAME.exec(error.message)?.[1];
  if (constraint) parts.push(`constraint ${constraint}`);

  return new Error(
    `Prisma rejected the ${description} write (${parts.join(', ')}; details omitted: they contain the written values)`,
  );
}

// `violates check constraint "name"` / `violates unique constraint "name"` ... — luôn nằm TRƯỚC phần DETAIL. Lỗi của
// connector Prisma in message dạng debug nên dấu nháy bị escape (`\"name\"`): `\\?` nhận cả hai dạng.
const CONSTRAINT_NAME = /violates [a-z -]+ constraint \\?"([A-Za-z0-9_]+)\\?"/;

// `DETAIL:` (Postgres qua SQL thô) và `detail: Some(` (định dạng debug của lỗi connector Prisma) là nơi Postgres đặt hàng/khoá
// vi phạm.
const DB_DETAIL = /\bDETAIL:|\bdetail:\s*Some\(/;

function carriesWrittenValues(error: Error): boolean {
  if (error instanceof Prisma.PrismaClientValidationError) return true;
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError) &&
    DB_DETAIL.test(error.message)
  );
}
