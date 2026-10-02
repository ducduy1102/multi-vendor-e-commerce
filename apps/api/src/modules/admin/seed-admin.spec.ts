import type { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
// Seed là script ngoài `src/` (prisma/seed.ts chạy bằng `prisma db seed`) — logic admin được tách
// sang `prisma/seed-admin.ts` để test được ở đây mà không phải chạy cả seed lên DB.
import { readSeedAdminConfig, seedAdmin } from '../../../prisma/seed-admin';

describe('readSeedAdminConfig', () => {
  it('thiếu cả hai biến ⇒ null (không có ý định tạo admin)', () => {
    expect(readSeedAdminConfig({})).toBeNull();
  });

  it('cả hai biến để trống (VAR= trong .env) ⇒ null như chưa khai', () => {
    expect(
      readSeedAdminConfig({ SEED_ADMIN_EMAIL: '', SEED_ADMIN_PASSWORD: '' }),
    ).toBeNull();
    expect(
      readSeedAdminConfig({ SEED_ADMIN_EMAIL: '  ', SEED_ADMIN_PASSWORD: '' }),
    ).toBeNull();
  });

  it('chỉ khai một trong hai ⇒ ném lỗi (không âm thầm bỏ qua)', () => {
    expect(() =>
      readSeedAdminConfig({ SEED_ADMIN_EMAIL: 'admin@example.com' }),
    ).toThrow(/phải được khai cùng nhau/);
    expect(() =>
      readSeedAdminConfig({ SEED_ADMIN_PASSWORD: 'password123' }),
    ).toThrow(/phải được khai cùng nhau/);
  });

  it('chuẩn hoá email (cắt khoảng trắng, chữ thường) như lúc register/login', () => {
    expect(
      readSeedAdminConfig({
        SEED_ADMIN_EMAIL: '  Admin@Example.COM ',
        SEED_ADMIN_PASSWORD: 'password123',
      }),
    ).toEqual({ email: 'admin@example.com', password: 'password123' });
  });

  it('không cắt khoảng trắng của mật khẩu (khoảng trắng là một phần của mật khẩu)', () => {
    expect(
      readSeedAdminConfig({
        SEED_ADMIN_EMAIL: 'admin@example.com',
        SEED_ADMIN_PASSWORD: ' pass word ',
      })?.password,
    ).toBe(' pass word ');
  });

  it.each([
    ['mật khẩu ngắn hơn 8', 'admin@example.com', 'short', 'password'],
    ['mật khẩu dài hơn 72', 'admin@example.com', 'a'.repeat(73), 'password'],
    ['email sai định dạng', 'not-an-email', 'password123', 'email'],
  ])(
    '%s ⇒ ném lỗi nêu đúng field, KHÔNG lộ giá trị mật khẩu',
    (_, email, password, field) => {
      let message = '';
      try {
        readSeedAdminConfig({
          SEED_ADMIN_EMAIL: email,
          SEED_ADMIN_PASSWORD: password,
        });
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain(field);
      expect(message).not.toContain(password);
    },
  );
});

describe('seedAdmin', () => {
  const config = { email: 'admin@example.com', password: 'password123' };
  interface CreateArgs {
    data: {
      email: string;
      passwordHash: string;
      role: string;
      emailVerifiedAt: Date;
    };
  }
  const user = {
    findUnique: jest.fn(),
    create: jest.fn<Promise<unknown>, [CreateArgs]>(),
    update: jest.fn(),
  };
  const prisma = { user } as unknown as PrismaClient;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('chưa có tài khoản ⇒ tạo ADMIN đã xác thực email, mật khẩu băm bằng bcrypt so khớp được', async () => {
    user.findUnique.mockResolvedValue(null);

    await expect(seedAdmin(prisma, config)).resolves.toBe('created');

    expect(user.create).toHaveBeenCalledTimes(1);
    const { data } = user.create.mock.calls[0][0];
    expect(data.email).toBe('admin@example.com');
    expect(data.role).toBe('ADMIN');
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(data.passwordHash).not.toBe(config.password);
    expect(await bcrypt.compare(config.password, data.passwordHash)).toBe(true);
    expect(user.update).not.toHaveBeenCalled();
  });

  it('đã có tài khoản USER cùng email ⇒ chỉ nâng role, KHÔNG đụng mật khẩu', async () => {
    user.findUnique.mockResolvedValue({ id: 'u1', role: 'USER' });

    await expect(seedAdmin(prisma, config)).resolves.toBe('promoted');

    expect(user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'ADMIN' },
    });
    expect(user.create).not.toHaveBeenCalled();
  });

  it('đã là ADMIN ⇒ không ghi gì (chạy lại seed idempotent)', async () => {
    user.findUnique.mockResolvedValue({ id: 'u1', role: 'ADMIN' });

    await expect(seedAdmin(prisma, config)).resolves.toBe('unchanged');

    expect(user.create).not.toHaveBeenCalled();
    expect(user.update).not.toHaveBeenCalled();
  });
});
