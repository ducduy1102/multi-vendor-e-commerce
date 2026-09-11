import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { MailService } from '../../shared/mail/mail.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { EMAIL_VERIFICATION_RESEND_COOLDOWN_MS } from './auth.constants';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  interface CreateUserArgs {
    data: {
      email: string;
      passwordHash: string;
      name: string;
      emailVerificationTokenHash?: string | null;
      emailVerificationExpiresAt?: Date | null;
      emailVerificationSentAt?: Date | null;
    };
  }
  interface UpdateUserArgs {
    where: { id: string };
    data: Record<string, unknown>;
  }

  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock<unknown, [CreateUserArgs]>;
      update: jest.Mock<unknown, [UpdateUserArgs]>;
    };
  };
  let mailService: { sendVerificationEmail: jest.Mock };

  const baseUser = {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: '',
    name: 'Test User',
    role: Role.USER,
    refreshTokenHash: null as string | null,
    emailVerifiedAt: null as Date | null,
    emailVerificationTokenHash: null as string | null,
    emailVerificationExpiresAt: null as Date | null,
    emailVerificationSentAt: null as Date | null,
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
        update: jest.fn<unknown, [UpdateUserArgs]>(),
      },
    };
    mailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mailService },
      ],
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
    });

    it('tạo token verify email (hash lưu DB, không lộ ra ngoài) và gửi mail xác thực', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseUser, ...data }),
      );

      const result = await service.register({
        email: 'new@example.com',
        password: 'password123',
        name: 'New User',
      });

      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs.data.emailVerificationTokenHash).toEqual(
        expect.any(String),
      );
      expect(createArgs.data.emailVerificationExpiresAt).toBeInstanceOf(Date);
      expect(result.user).not.toHaveProperty('emailVerificationTokenHash');
      expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
        'new@example.com',
        'New User',
        expect.stringContaining('/verify-email?token='),
      );
    });

    // Regression test: user đã tạo thành công trong DB trước khi gửi mail —
    // nếu provider mail lỗi (Resend down/sai key/hết quota), register() vẫn
    // phải trả thành công (chỉ log lỗi), không được để cả request thất bại
    // trong khi user thực ra đã được tạo (lần đăng ký lại sau sẽ báo nhầm
    // "email đã tồn tại").
    it('vẫn trả user thành công dù gửi mail xác thực thất bại', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseUser, ...data }),
      );
      mailService.sendVerificationEmail.mockRejectedValue(
        new Error('Resend API lỗi'),
      );

      const result = await service.register({
        email: 'new@example.com',
        password: 'password123',
        name: 'New User',
      });

      expect(result.user.email).toBe('new@example.com');
    });

    it('không issue token/tạo session (không auto-login sau khi đăng ký)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseUser, ...data }),
      );

      const result = await service.register({
        email: 'new@example.com',
        password: 'password123',
        name: 'New User',
      });

      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
      expect(prisma.user.update).not.toHaveBeenCalled();
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

  describe('me', () => {
    it('trả user hiện tại, không lộ passwordHash/refreshTokenHash', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser });

      const result = await service.me(baseUser.id);

      expect(result.user.id).toBe(baseUser.id);
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('refreshTokenHash');
    });

    it('báo lỗi 401 nếu user không còn tồn tại (đã bị xoá sau khi token issue)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.me('deleted-user-id')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('verifyEmail', () => {
    it('xác thực thành công: set emailVerifiedAt, xoá token hash/expiry', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        emailVerificationTokenHash: createHash('sha256')
          .update('valid-raw-token')
          .digest('hex'),
        emailVerificationExpiresAt: new Date(Date.now() + 60_000),
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.verifyEmail('valid-raw-token');

      expect(result.message).toBeDefined();
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: baseUser.id });
      expect(updateArgs.data.emailVerifiedAt).toBeInstanceOf(Date);
      expect(updateArgs.data.emailVerificationTokenHash).toBeNull();
      expect(updateArgs.data.emailVerificationExpiresAt).toBeNull();
    });

    it('báo lỗi 400 nếu token không khớp user nào', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyEmail('token-khong-ton-tai'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('báo lỗi 400 nếu token đã hết hạn', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        emailVerificationTokenHash: createHash('sha256')
          .update('expired-raw-token')
          .digest('hex'),
        emailVerificationExpiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.verifyEmail('expired-raw-token'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('resendVerification', () => {
    it('báo lỗi 400 nếu email đã được xác thực', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        emailVerifiedAt: new Date(),
      });

      await expect(
        service.resendVerification(baseUser.id),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mailService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('báo lỗi 429 nếu gửi lại quá nhanh (còn trong cooldown)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        emailVerificationSentAt: new Date(
          Date.now() - EMAIL_VERIFICATION_RESEND_COOLDOWN_MS / 2,
        ),
      });

      await expect(
        service.resendVerification(baseUser.id),
      ).rejects.toMatchObject({ status: 429 });
      expect(mailService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('gửi lại thành công: tạo token mới, cập nhật sentAt, gọi mailService', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        emailVerificationSentAt: new Date(
          Date.now() - EMAIL_VERIFICATION_RESEND_COOLDOWN_MS * 2,
        ),
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.resendVerification(baseUser.id);

      expect(result.message).toBeDefined();
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: baseUser.id });
      expect(updateArgs.data.emailVerificationTokenHash).toEqual(
        expect.any(String),
      );
      expect(updateArgs.data.emailVerificationExpiresAt).toBeInstanceOf(Date);
      expect(updateArgs.data.emailVerificationSentAt).toBeInstanceOf(Date);
      expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
        baseUser.email,
        baseUser.name,
        expect.stringContaining('/verify-email?token='),
      );
    });

    it('vẫn trả thành công dù gửi mail xác thực thất bại (đã cập nhật token mới trong DB)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        emailVerificationSentAt: new Date(
          Date.now() - EMAIL_VERIFICATION_RESEND_COOLDOWN_MS * 2,
        ),
      });
      prisma.user.update.mockResolvedValue({});
      mailService.sendVerificationEmail.mockRejectedValue(
        new Error('Resend API lỗi'),
      );

      const result = await service.resendVerification(baseUser.id);

      expect(result.message).toBeDefined();
    });
  });
});
