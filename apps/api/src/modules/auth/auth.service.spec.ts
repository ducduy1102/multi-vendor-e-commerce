import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  interface CreateUserArgs {
    data: { email: string; passwordHash: string; name: string };
  }

  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock<unknown, [CreateUserArgs]>;
      update: jest.Mock;
    };
  };

  const baseUser = {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: '',
    name: 'Test User',
    role: Role.USER,
    refreshTokenHash: null as string | null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn<unknown, [CreateUserArgs]>(),
        update: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [AuthService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(AuthService);
    jwtService = moduleRef.get(JwtService);
  });

  describe('register', () => {
    it('báo lỗi 400 nếu email đã tồn tại', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser });

      await expect(
        service.register({
          email: baseUser.email,
          password: 'password123',
          name: 'X',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('hash password trước khi lưu (không lưu plaintext), không trả passwordHash/refreshTokenHash ra ngoài', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseUser, ...data }),
      );
      prisma.user.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseUser, ...data }),
      );

      const result = await service.register({
        email: 'new@example.com',
        password: 'password123',
        name: 'New User',
      });

      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs.data.passwordHash).not.toBe('password123');
      expect(
        await bcrypt.compare('password123', createArgs.data.passwordHash),
      ).toBe(true);

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('refreshTokenHash');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });
  });

  describe('login', () => {
    it('báo lỗi 401 nếu không tìm thấy user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'none@example.com', password: 'password123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('báo lỗi 401 nếu sai mật khẩu', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 10);
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, passwordHash });

      await expect(
        service.login({ email: baseUser.email, password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('login đúng trả token hợp lệ, payload đúng userId + role (phân quyền dựa vào claim này)', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 10);
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        role: Role.ADMIN,
        passwordHash,
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.login({
        email: baseUser.email,
        password: 'correct-password',
      });

      const payload = jwtService.decode<{ sub: string; role: string }>(
        result.accessToken,
      );
      expect(payload.sub).toBe(baseUser.id);
      expect(payload.role).toBe(Role.ADMIN);
    });
  });

  describe('refreshTokens', () => {
    it('báo lỗi 401 nếu user chưa từng issue refresh token', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        refreshTokenHash: null,
      });

      await expect(
        service.refreshTokens(baseUser.id, 'bat-ky-token-nao'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('báo lỗi 401 nếu refresh token không khớp hash lưu trong DB', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        refreshTokenHash: 'hash-cua-mot-token-khac',
      });

      await expect(
        service.refreshTokens(baseUser.id, 'token-khong-khop'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('cấp token mới + rotate hash nếu refresh token khớp', async () => {
      const currentRefreshToken = await jwtService.signAsync(
        { sub: baseUser.id, role: baseUser.role },
        { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '7d' },
      );
      const storedHash = createHash('sha256')
        .update(currentRefreshToken)
        .digest('hex');
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        refreshTokenHash: storedHash,
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.refreshTokens(
        baseUser.id,
        currentRefreshToken,
      );

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: baseUser.id } }),
      );
    });

    // Regression test cho bug thật đã phát hiện qua test tay ở Bước 2.6:
    // bcrypt chỉ đọc 72 byte đầu input, mà 2 JWT của cùng 1 user luôn trùng
    // phần đầu (header + sub + role) — phần khác nhau (iat/exp/chữ ký) nằm
    // sau byte 72, khiến bcrypt.compare báo khớp nhầm. Test này tạo 2 token
    // thật khác nhau (cách nhau ≥1s để iat chắc chắn khác) và xác nhận
    // token B KHÔNG được chấp nhận khi hash lưu trong DB là của token A.
    it('không chấp nhận refresh token khác dù trùng phần đầu JWT với token đã lưu', async () => {
      const tokenA = await jwtService.signAsync(
        { sub: baseUser.id, role: baseUser.role },
        { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '7d' },
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const tokenB = await jwtService.signAsync(
        { sub: baseUser.id, role: baseUser.role },
        { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '7d' },
      );
      expect(tokenA).not.toBe(tokenB);

      const hashOfTokenA = createHash('sha256').update(tokenA).digest('hex');
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        refreshTokenHash: hashOfTokenA,
      });

      await expect(
        service.refreshTokens(baseUser.id, tokenB),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }, 10000);
  });

  describe('logout', () => {
    it('xoá refreshTokenHash trong DB', async () => {
      prisma.user.update.mockResolvedValue({});

      await service.logout(baseUser.id);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: baseUser.id },
        data: { refreshTokenHash: null },
      });
    });
  });
});
