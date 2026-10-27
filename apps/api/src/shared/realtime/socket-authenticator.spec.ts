import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { AccountStatus, Role } from '@prisma/client';
import { createHmac } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';
import { JwtSocketAuthenticator } from './socket-authenticator';

const SECRET = 'test-access-secret';

// Dựng JWT bằng tay để thử các token mà JwtService.sign không cho tạo (alg khác, không có chữ ký).
const base64Url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

describe('JwtSocketAuthenticator', () => {
  const jwt = new JwtService();
  const findUnique = jest.fn();
  const authenticator = new JwtSocketAuthenticator(jwt, {
    user: { findUnique },
  } as unknown as PrismaService);
  const originalSecret = process.env.JWT_ACCESS_SECRET;

  const sign = (
    payload: Record<string, unknown>,
    options: {
      secret?: string;
      expiresIn?: JwtSignOptions['expiresIn'];
      algorithm?: 'HS256' | 'HS512';
    } = {},
  ) =>
    jwt.signAsync(payload, {
      secret: options.secret ?? SECRET,
      algorithm: options.algorithm ?? 'HS256',
      // jsonwebtoken từ chối khoá `expiresIn: undefined` khai tường minh, nên chỉ thêm khi có.
      ...(options.expiresIn !== undefined
        ? { expiresIn: options.expiresIn }
        : {}),
    });

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRET;
    findUnique.mockReset();
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = originalSecret;
  });

  describe('verifyToken', () => {
    it('access token hợp lệ ⇒ userId và exp (giây)', async () => {
      const token = await sign(
        { sub: 'user-1', role: Role.USER },
        { expiresIn: '15m' },
      );

      const verified = await authenticator.verifyToken(token);

      expect(verified).toEqual({
        userId: 'user-1',
        exp: expect.any(Number) as number,
      });
      const secondsLeft = (verified?.exp ?? 0) - Date.now() / 1000;
      expect(secondsLeft).toBeGreaterThan(14 * 60);
      expect(secondsLeft).toBeLessThanOrEqual(15 * 60);
    });

    it('KHÔNG trả role của payload: đó chỉ là bản chụp lúc cấp token, không phải căn cứ phân quyền', async () => {
      const token = await sign(
        { sub: 'user-1', role: Role.ADMIN },
        { expiresIn: '15m' },
      );

      const verified = await authenticator.verifyToken(token);

      expect(verified).not.toBeNull();
      expect(verified).not.toHaveProperty('role');
      expect(JSON.stringify(verified)).not.toContain(Role.ADMIN);
    });

    it('ký bằng secret khác ⇒ null', async () => {
      const token = await sign(
        { sub: 'user-1', role: Role.USER },
        { secret: 'another-secret', expiresIn: '15m' },
      );

      await expect(authenticator.verifyToken(token)).resolves.toBeNull();
    });

    it('đã hết hạn ⇒ null', async () => {
      const token = await sign({
        sub: 'user-1',
        role: Role.USER,
        exp: Math.floor(Date.now() / 1000) - 10,
      });

      await expect(authenticator.verifyToken(token)).resolves.toBeNull();
    });

    it('token KHÔNG có hạn (không exp) ⇒ null: không chấp nhận token sống vĩnh viễn', async () => {
      const token = await sign({ sub: 'user-1', role: Role.USER });

      await expect(authenticator.verifyToken(token)).resolves.toBeNull();
    });

    it('thuật toán khác HS256 (HS512 cùng secret) ⇒ null', async () => {
      const token = await sign(
        { sub: 'user-1', role: Role.USER },
        { algorithm: 'HS512', expiresIn: '15m' },
      );

      await expect(authenticator.verifyToken(token)).resolves.toBeNull();
    });

    it('token "alg: none" (không chữ ký) ⇒ null', async () => {
      const header = base64Url({ alg: 'none', typ: 'JWT' });
      const body = base64Url({
        sub: 'user-1',
        role: Role.ADMIN,
        exp: Math.floor(Date.now() / 1000) + 600,
      });

      await expect(
        authenticator.verifyToken(`${header}.${body}.`),
      ).resolves.toBeNull();
    });

    it('chữ ký bị sửa một ký tự ⇒ null', async () => {
      const token = await sign(
        { sub: 'user-1', role: Role.USER },
        { expiresIn: '15m' },
      );
      const [header, body, signature] = token.split('.');
      const flipped = signature.endsWith('A') ? 'B' : 'A';
      const tampered = `${header}.${body}.${signature.slice(0, -1)}${flipped}`;

      await expect(authenticator.verifyToken(tampered)).resolves.toBeNull();
    });

    it.each([
      ['thiếu sub', { role: Role.USER }],
      ['sub rỗng', { sub: '', role: Role.USER }],
      ['role lạ', { sub: 'user-1', role: 'SUPERUSER' }],
      ['thiếu role', { sub: 'user-1' }],
      ['sub không phải chuỗi', { sub: 123, role: Role.USER }],
    ])(
      'payload sai hình dạng (%s) ⇒ null dù chữ ký đúng',
      async (_name, payload) => {
        const token = await sign(payload, { expiresIn: '15m' });

        await expect(authenticator.verifyToken(token)).resolves.toBeNull();
      },
    );

    it.each(['', 'garbage', 'a.b.c', '....'])(
      'chuỗi không phải JWT (%j) ⇒ null',
      async (token) => {
        await expect(authenticator.verifyToken(token)).resolves.toBeNull();
      },
    );

    it('chữ ký đúng nhưng ký bằng secret rỗng không được chấp nhận như hợp lệ', async () => {
      const forged = (() => {
        const header = base64Url({ alg: 'HS256', typ: 'JWT' });
        const body = base64Url({
          sub: 'user-1',
          role: Role.ADMIN,
          exp: Math.floor(Date.now() / 1000) + 600,
        });
        const signature = createHmac('sha256', '')
          .update(`${header}.${body}`)
          .digest('base64url');
        return `${header}.${body}.${signature}`;
      })();

      await expect(authenticator.verifyToken(forged)).resolves.toBeNull();
    });

    it.each([
      ['không khai', undefined],
      ['để trống', ''],
      ['toàn khoảng trắng', '   '],
    ])(
      'JWT_ACCESS_SECRET %s ⇒ NÉM lỗi cấu hình (đóng), không coi là "token sai"',
      async (_name, value) => {
        if (value === undefined) delete process.env.JWT_ACCESS_SECRET;
        else process.env.JWT_ACCESS_SECRET = value;

        await expect(authenticator.verifyToken('x.y.z')).rejects.toThrow(
          'JWT_ACCESS_SECRET is not configured',
        );
      },
    );
  });

  describe('isUserActive', () => {
    it('chỉ ACTIVE mới là true', async () => {
      findUnique.mockResolvedValueOnce({ accountStatus: AccountStatus.ACTIVE });

      await expect(authenticator.isUserActive('user-1')).resolves.toBe(true);
    });

    it.each([
      AccountStatus.SUSPENDED,
      AccountStatus.BANNED,
      AccountStatus.DEACTIVATED,
    ])('%s ⇒ false', async (accountStatus) => {
      findUnique.mockResolvedValueOnce({ accountStatus });

      await expect(authenticator.isUserActive('user-1')).resolves.toBe(false);
    });

    it('người dùng không tồn tại ⇒ false', async () => {
      findUnique.mockResolvedValueOnce(null);

      await expect(authenticator.isUserActive('ghost')).resolves.toBe(false);
    });

    it('chỉ truy vấn đúng theo id và chỉ lấy accountStatus', async () => {
      findUnique.mockResolvedValueOnce({ accountStatus: AccountStatus.ACTIVE });

      await authenticator.isUserActive('user-1');

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { accountStatus: true },
      });
    });

    it('lỗi DB được ném tiếp (nơi gọi đóng kết nối)', async () => {
      findUnique.mockRejectedValueOnce(new Error('db down'));

      await expect(authenticator.isUserActive('user-1')).rejects.toThrow(
        'db down',
      );
    });
  });
});
