import { Prisma } from '@prisma/client';
import { redactWriteError } from './redact-write-error';

// redactWriteError che lỗi ghi của Prisma mang giá trị riêng tư. Các chuỗi message dưới đây lấy từ lỗi THẬT đo trên
// Postgres (Week11.md 2.4); tệp int-spec của từng đường ghi (chat, nhật ký quản trị) kiểm lại với DB thật.
const SECRET = 'lý-do-riêng-tư-cần-giữ-kín';
const CLIENT = { clientVersion: 'test' };

const checkViolationUnknown = () =>
  new Prisma.PrismaClientUnknownRequestError(
    `\nInvalid \`prisma.adminAuditLog.create()\` invocation:\n\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \\"admin_audit_logs\\" violates check constraint \\"admin_audit_logs_action_format\\"", severity: "ERROR", detail: Some("Failing row contains (6c135c7f, 029d1321, bad, USER, 6b8fe97b, ${SECRET}, {}, null, null, 2026-10-27 10:07:49.403)."), column: None, hint: None }), transient: false })`,
    CLIENT,
  );

const rawCheckViolation = () =>
  new Prisma.PrismaClientKnownRequestError(
    `\nInvalid \`prisma.$executeRaw()\` invocation:\n\n\nRaw query failed. Code: \`23514\`. Message: \`ERROR: new row for relation "admin_audit_logs" violates check constraint "admin_audit_logs_reason_length_in_range"\nDETAIL: Failing row contains (6e73eaab, 6e99fe1a, X, USER, c1db88bd, ${SECRET}, {}, null, null, 2026-10-27 10:07:49.413).\``,
    { code: 'P2010', ...CLIENT },
  );

const text = (error: unknown) =>
  `${(error as Error).message}\n${(error as Error).stack}`;

describe('redactWriteError', () => {
  describe('che lỗi mang giá trị đã ghi', () => {
    it('PrismaClientValidationError (in cả đoạn gọi kèm data) ⇒ lỗi chung, message và stack không còn giá trị', () => {
      const leaky = new Prisma.PrismaClientValidationError(
        `Invalid prisma.adminAuditLog.create() invocation: data: { reason: "${SECRET}" }`,
        CLIENT,
      );

      const result = redactWriteError(leaky, 'admin audit log');

      expect(result).toBeInstanceOf(Error);
      expect(result).not.toBe(leaky);
      expect(result).not.toBeInstanceOf(Prisma.PrismaClientValidationError);
      expect(text(result)).not.toContain(SECRET);
      expect((result as Error).message).toBe(
        'Prisma rejected the admin audit log write (PrismaClientValidationError; details omitted: they contain the written values)',
      );
    });

    it('vi phạm CHECK qua API model (PrismaClientUnknownRequestError, `detail: Some(...)`) ⇒ che hàng, GIỮ tên ràng buộc để chẩn đoán', () => {
      const result = redactWriteError(
        checkViolationUnknown(),
        'admin audit log',
      );

      expect(text(result)).not.toContain(SECRET);
      expect(text(result)).not.toContain('Failing row');
      expect((result as Error).message).toContain(
        'constraint admin_audit_logs_action_format',
      );
      expect((result as Error).message).toContain(
        'PrismaClientUnknownRequestError',
      );
    });

    it('vi phạm CHECK qua SQL thô (P2010, `DETAIL:`) ⇒ che hàng, giữ mã Prisma và tên ràng buộc', () => {
      const result = redactWriteError(rawCheckViolation(), 'admin audit log');

      expect(text(result)).not.toContain(SECRET);
      expect((result as Error).message).toContain('P2010');
      expect((result as Error).message).toContain(
        'constraint admin_audit_logs_reason_length_in_range',
      );
    });

    it('vi phạm UNIQUE qua SQL thô ("Key (email)=(…) already exists") cũng bị che', () => {
      const error = new Prisma.PrismaClientKnownRequestError(
        `Raw query failed. Code: \`23505\`. Message: \`ERROR: duplicate key value violates unique constraint "users_email_key"\nDETAIL: Key (email)=(${SECRET}@x.test) already exists.\``,
        { code: 'P2010', ...CLIENT },
      );

      const result = redactWriteError(error, 'user');

      expect(text(result)).not.toContain(SECRET);
      expect((result as Error).message).toContain('constraint users_email_key');
    });

    it('không gắn `cause` (cause được in cùng stack nên sẽ làm lộ lại giá trị)', () => {
      const result = redactWriteError(rawCheckViolation(), 'admin audit log');

      expect((result as Error).cause).toBeUndefined();
    });

    it('chỉ nhận tên ràng buộc dạng chữ-số-gạch dưới: ký tự lạ trong message không lọt vào kết quả', () => {
      const error = new Prisma.PrismaClientKnownRequestError(
        `ERROR: new row violates check constraint "x"; ${SECRET}\nDETAIL: Failing row contains (${SECRET}).`,
        { code: 'P2010', ...CLIENT },
      );

      const result = redactWriteError(error, 'admin audit log');

      expect(text(result)).not.toContain(SECRET);
    });
  });

  describe('lỗi KHÔNG mang giá trị được ném NGUYÊN (giữ thông tin chẩn đoán và mã lỗi cho nơi gọi)', () => {
    it.each([
      ['Error thường (DB sập)', () => new Error('db down')],
      [
        'P2002 của model API (không có DETAIL)',
        () =>
          new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed on the fields: (`client_message_id`)',
            { code: 'P2002', ...CLIENT, meta: { modelName: 'Message' } },
          ),
      ],
      [
        'P2003 khoá ngoại (không có DETAIL)',
        () =>
          new Prisma.PrismaClientKnownRequestError(
            'Foreign key constraint violated on the constraint: `notifications_user_id_fkey`',
            { code: 'P2003', ...CLIENT },
          ),
      ],
      [
        'lỗi trigger chỉ-thêm (RAISE EXCEPTION không kèm DETAIL)',
        () =>
          new Prisma.PrismaClientUnknownRequestError(
            'Error occurred during query execution: PostgresError { code: "23001", message: "admin_audit_logs is append-only: UPDATE is not allowed", severity: "ERROR", detail: None }',
            CLIENT,
          ),
      ],
    ])('%s', (_name, make) => {
      const error = make();

      expect(redactWriteError(error, 'admin audit log')).toBe(error);
    });

    it.each([
      ['một chuỗi', 'boom'],
      ['null', null],
      ['undefined', undefined],
    ])('giá trị không phải Error (%s) đi qua nguyên', (_name, value) => {
      expect(redactWriteError(value, 'admin audit log')).toBe(value);
    });
  });
});
