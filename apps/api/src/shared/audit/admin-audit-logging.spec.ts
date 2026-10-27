import { ArgumentsHost, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import {
  AdminAuditService,
  type AdminAuditClient,
} from './admin-audit.service';

// Đường ghi nhật ký quản trị không được đẩy LÝ DO do Admin nhập vào log (Week11.md 2.4). Đi qua AllExceptionsFilter THẬT —
// nơi log toàn bộ `stack` của lỗi không lường trước — và chứng minh bằng đối chứng: cùng lỗi, nếu KHÔNG che thì canary
// xuất hiện trong log (nên test này đỏ được, không phải xanh vì bộ lọc im lặng). Định dạng lỗi lấy từ lỗi thật đo trên
// Postgres; admin-audit.int-spec.ts kiểm lại với DB thật.
const CANARY = `canary-${randomUUID()}`;
const CLIENT = { clientVersion: 'test' };

const validationError = () =>
  new Prisma.PrismaClientValidationError(
    `Invalid \`prisma.adminAuditLog.create()\` invocation: data: { reason: "${CANARY}" }`,
    CLIENT,
  );
const checkViolation = () =>
  new Prisma.PrismaClientUnknownRequestError(
    `Error occurred during query execution: PostgresError { code: "23514", message: "new row for relation \\"admin_audit_logs\\" violates check constraint \\"admin_audit_logs_reason_length_in_range\\"", severity: "ERROR", detail: Some("Failing row contains (a, b, SUSPEND_USER, USER, c, ${CANARY}, {}, null, null, 2026-10-27 10:07:49.403)."), column: None, hint: None }`,
    CLIENT,
  );
const rawCheckViolation = () =>
  new Prisma.PrismaClientKnownRequestError(
    `Raw query failed. Code: \`23514\`. Message: \`ERROR: new row for relation "admin_audit_logs" violates check constraint "admin_audit_logs_reason_length_in_range"\nDETAIL: Failing row contains (a, b, SUSPEND_USER, USER, c, ${CANARY}, {}, null, null, 2026-10-27).\``,
    { code: 'P2010', ...CLIENT },
  );

const entry = {
  actorId: randomUUID(),
  action: 'SUSPEND_USER',
  targetType: 'USER',
  targetId: randomUUID(),
  reason: CANARY,
} as const;

describe('ghi nhật ký quản trị không làm lộ lý do ra log', () => {
  let logged: string[];
  let responses: unknown[];

  const host = () => {
    const res: { status: jest.Mock; json: jest.Mock } = {
      status: jest.fn(),
      json: jest.fn(),
    };
    res.status.mockReturnValue(res);
    res.json.mockImplementation((body: unknown) => {
      responses.push(body);
      return res;
    });
    const getResponse = (): typeof res => res;
    return {
      switchToHttp: () => ({ getResponse }),
    } as unknown as ArgumentsHost;
  };

  // Chạy lỗi qua bộ lọc toàn cục như khi nó lan ra khỏi controller.
  const handle = (error: unknown) =>
    new AllExceptionsFilter().catch(error, host());

  const clientFailingWith = (error: unknown) =>
    ({
      adminAuditLog: { create: jest.fn().mockRejectedValue(error) },
    }) as unknown as AdminAuditClient;

  beforeEach(() => {
    logged = [];
    responses = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((...args) => {
      logged.push(args.map(String).join(' '));
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['PrismaClientValidationError', validationError],
    ['vi phạm CHECK qua API model', checkViolation],
    ['vi phạm CHECK qua SQL thô', rawCheckViolation],
  ])('%s: log không có lý do, response không có lý do', async (_name, make) => {
    const error = await new AdminAuditService()
      .record(clientFailingWith(make()), entry)
      .catch((e: unknown) => e);

    handle(error);

    // Không phải test rỗng: lỗi PHẢI để lại dấu vết trong log (cái gì thất bại, ở ràng buộc nào)...
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('admin audit log');
    expect(logged[0]).toContain('details omitted');
    // ...nhưng không có lý do.
    expect(logged.join('\n')).not.toContain(CANARY);
    expect(JSON.stringify(responses)).not.toContain(CANARY);
  });

  it('log vẫn cho biết ràng buộc nào bị vi phạm (đủ để chẩn đoán mà không cần giá trị)', async () => {
    const error = await new AdminAuditService()
      .record(clientFailingWith(checkViolation()), entry)
      .catch((e: unknown) => e);

    handle(error);

    expect(logged[0]).toContain(
      'constraint admin_audit_logs_reason_length_in_range',
    );
  });

  describe('đối chứng: nếu KHÔNG che thì canary lọt vào log (chứng minh rò rỉ là thật và test ở trên có thể đỏ)', () => {
    it.each([
      ['PrismaClientValidationError', validationError],
      ['vi phạm CHECK qua API model', checkViolation],
      ['vi phạm CHECK qua SQL thô', rawCheckViolation],
    ])('%s', (_name, make) => {
      handle(make());

      expect(logged.join('\n')).toContain(CANARY);
    });
  });

  it('lỗi không mang giá trị (DB sập) vẫn được ném nguyên và log đầy đủ để chẩn đoán', async () => {
    const dbDown = new Error('connection terminated unexpectedly');

    const error = await new AdminAuditService()
      .record(clientFailingWith(dbDown), entry)
      .catch((e: unknown) => e);

    expect(error).toBe(dbDown);
    handle(error);
    expect(logged.join('\n')).toContain('connection terminated unexpectedly');
  });
});
