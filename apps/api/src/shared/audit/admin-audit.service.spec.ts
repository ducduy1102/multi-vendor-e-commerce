import { randomUUID } from 'crypto';
import {
  AdminAuditService,
  InvalidAdminAuditEntryError,
  type AdminAuditClient,
} from './admin-audit.service';

// Unit test với client giả: khoá điều service PHẢI làm với client được truyền vào (ghi đúng cột, đúng giá trị mặc định,
// không dùng client nào khác) và điều nó KHÔNG được làm (ghi mục sai, nuốt lỗi, làm lộ lý do vào thông điệp lỗi). Việc
// "commit/rollback cùng transaction nghiệp vụ" và CHECK ở DB do admin-audit.int-spec.ts chứng minh trên Postgres thật.
const ACTOR_ID = randomUUID();
const TARGET_ID = randomUUID();

function fakeClient() {
  const create = jest.fn().mockResolvedValue({ id: randomUUID() });
  const client = { adminAuditLog: { create } } as unknown as AdminAuditClient;
  return { client, create };
}

// Phần `data` của lần gọi `create` đầu tiên (mock.calls là any[][] nên ép kiểu tường minh một chỗ).
const writtenData = (create: jest.Mock) =>
  (create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;

const valid = {
  actorId: ACTOR_ID,
  action: 'SUSPEND_USER',
  targetType: 'USER',
  targetId: TARGET_ID,
} as const;

describe('AdminAuditService.record', () => {
  let service: AdminAuditService;

  beforeEach(() => {
    service = new AdminAuditService();
  });

  it('ghi đúng một dòng với các cột đã chuẩn hoá và chỉ select id', async () => {
    const { client, create } = fakeClient();
    const conversationId = randomUUID();

    await service.record(client, {
      ...valid,
      reason: 'Vi phạm điều khoản',
      meta: { to: 'BANNED', conversationId },
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: ACTOR_ID,
        action: 'SUSPEND_USER',
        targetType: 'USER',
        targetId: TARGET_ID,
        reason: 'Vi phạm điều khoản',
        meta: { to: 'BANNED', conversationId },
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
      },
      select: { id: true },
    });
  });

  it('không có lý do, meta, ip, userAgent ⇒ NULL, object rỗng, NULL, NULL (không phải undefined)', async () => {
    const { client, create } = fakeClient();

    await service.record(client, valid);

    expect(writtenData(create)).toEqual({
      actorId: ACTOR_ID,
      action: 'SUSPEND_USER',
      targetType: 'USER',
      targetId: TARGET_ID,
      reason: null,
      meta: {},
      ip: null,
      userAgent: null,
    });
  });

  it('không bao giờ tự đưa createdAt vào câu ghi: giờ do đồng hồ DB đóng dấu', async () => {
    const { client, create } = fakeClient();

    await service.record(client, valid);

    expect(writtenData(create)).not.toHaveProperty('createdAt');
  });

  it('lý do null ⇒ reason NULL', async () => {
    const { client, create } = fakeClient();

    await service.record(client, { ...valid, reason: null });

    expect(writtenData(create).reason).toBeNull();
  });

  it('ghi lý do ĐÃ chuẩn hoá (cắt khoảng trắng, CRLF → LF), không phải chuỗi gốc', async () => {
    const { client, create } = fakeClient();

    await service.record(client, {
      ...valid,
      reason: '  dòng 1\r\ndòng 2  ',
    });

    expect(writtenData(create).reason).toBe('dòng 1\ndòng 2');
  });

  it('chỉ ghi qua client được truyền vào (tx của transaction nghiệp vụ), không đụng client nào khác', async () => {
    const inTransaction = fakeClient();
    const elsewhere = fakeClient();

    await service.record(inTransaction.client, valid);

    expect(inTransaction.create).toHaveBeenCalledTimes(1);
    expect(elsewhere.create).not.toHaveBeenCalled();
  });

  it('không sửa đối tượng đầu vào của nơi gọi', async () => {
    const { client } = fakeClient();
    const input = { ...valid, reason: ' có khoảng trắng ', meta: { n: 1 } };
    const snapshot = structuredClone(input);

    await service.record(client, input);

    expect(input).toEqual(snapshot);
  });

  describe('mục sai hình dạng', () => {
    const invalid: [string, Record<string, unknown>][] = [
      ['hành động lạ', { ...valid, action: 'DELETE_EVERYTHING' }],
      ['loại đối tượng lệch hành động', { ...valid, targetType: 'SHOP' }],
      ['actorId không phải UUID', { ...valid, actorId: 'admin' }],
      ['targetId không phải UUID', { ...valid, targetId: 'user' }],
      ['lý do rỗng', { ...valid, reason: '   ' }],
      ['lý do quá dài', { ...valid, reason: 'a'.repeat(501) }],
      ['meta có chữ tự do', { ...valid, meta: { note: 'xin chào' } }],
      ['khoá lạ', { ...valid, id: randomUUID() }],
      ['createdAt do client đưa vào', { ...valid, createdAt: new Date() }],
      ['ip không phải địa chỉ', { ...valid, ip: 'not-an-ip' }],
      ['userAgent nhiều dòng', { ...valid, userAgent: 'a\nb' }],
    ];

    it.each(invalid)(
      '%s ⇒ ném InvalidAdminAuditEntryError và KHÔNG ghi gì',
      async (_name, entry) => {
        const { client, create } = fakeClient();

        await expect(
          service.record(client, entry as never),
        ).rejects.toBeInstanceOf(InvalidAdminAuditEntryError);
        expect(create).not.toHaveBeenCalled();
      },
    );

    it('thông điệp lỗi chỉ có đường dẫn và mã lỗi, KHÔNG chứa giá trị đã truyền (lý do có thể riêng tư)', async () => {
      const { client } = fakeClient();
      const canary = `canary-${randomUUID()}`;

      const error = await service
        .record(client, {
          ...valid,
          action: canary,
          targetId: canary,
          reason: `${canary} ${'x'.repeat(500)}`,
          meta: { note: canary },
        } as never)
        .catch((e: unknown) => e as Error);

      expect(error).toBeInstanceOf(InvalidAdminAuditEntryError);
      expect((error as Error).message).not.toContain(canary);
      expect((error as Error).stack).not.toContain(canary);
      expect((error as Error).message).toMatch(/^Invalid admin audit entry: /);
      expect((error as Error).message).toContain('action: invalid_enum_value');
    });
  });

  it('lỗi từ DB được ném lại nguyên vẹn, KHÔNG bị nuốt (để transaction nghiệp vụ rollback)', async () => {
    const { client, create } = fakeClient();
    const failure = new Error('connection terminated');
    create.mockRejectedValue(failure);

    await expect(service.record(client, valid)).rejects.toBe(failure);
  });
});
