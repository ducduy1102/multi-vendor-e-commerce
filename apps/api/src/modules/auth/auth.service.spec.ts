import {
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AccountStatus, OAuthProvider, Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { MailService } from '../../shared/mail/mail.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { REALTIME_EMITTER } from '../../shared/realtime/realtime-emitter';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import {
  createFakeRealtimeEmitter,
  type FakeRealtimeEmitter,
} from '../../shared/testing/fake-realtime-emitter';
import { EMAIL_VERIFICATION_RESEND_COOLDOWN_MS } from './auth.constants';
import { AuthService, FORGOT_PASSWORD_MESSAGE } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  interface CreateUserArgs {
    data: {
      email: string;
      passwordHash: string | null;
      name: string;
      locale?: 'vi' | 'en';
      emailVerificationTokenHash?: string | null;
      emailVerificationExpiresAt?: Date | null;
      emailVerificationSentAt?: Date | null;
      emailVerifiedAt?: Date | null;
      oauthAccounts?: {
        create: { provider: OAuthProvider; providerUserId: string };
      };
    };
  }
  interface UpdateUserArgs {
    where: { id: string };
    data: Record<string, unknown>;
  }

  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock<Promise<unknown>, [CreateUserArgs]>;
      update: jest.Mock<Promise<unknown>, [UpdateUserArgs]>;
      updateMany: jest.Mock;
    };
    oAuthAccount: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };
  let realtime: FakeRealtimeEmitter;
  let mailService: {
    sendVerificationEmail: jest.Mock;
    sendPasswordReset: jest.Mock;
    sendPasswordChanged: jest.Mock;
  };

  const baseUser = {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: '',
    name: 'Test User',
    role: Role.USER,
    accountStatus: AccountStatus.ACTIVE,
    refreshTokenHash: null as string | null,
    locale: 'vi' as 'vi' | 'en',
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
        create: jest.fn<Promise<unknown>, [CreateUserArgs]>(),
        update: jest.fn<Promise<unknown>, [UpdateUserArgs]>(),
        updateMany: jest.fn(),
      },
      oAuthAccount: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
    mailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordReset: jest.fn().mockResolvedValue(undefined),
      sendPasswordChanged: jest.fn().mockResolvedValue(undefined),
    };

    realtime = createFakeRealtimeEmitter();

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mailService },
        { provide: REALTIME_EMITTER, useValue: realtime },
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
      // register() luôn tạo passwordHash thật (khác loginWithGoogle, nơi nó
      // null) — non-null assertion an toàn ở đây, chỉ để khớp type sau khi
      // nới `CreateUserArgs.data.passwordHash` thành `string | null`.
      expect(
        await bcrypt.compare('password123', createArgs.data.passwordHash!),
      ).toBe(true);

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('refreshTokenHash');
    });

    it('lưu locale người đăng ký chọn; bỏ trống thì dùng ngôn ngữ mặc định vi', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseUser, ...data }),
      );

      await service.register({
        email: 'en@example.com',
        password: 'password123',
        name: 'English User',
        locale: 'en',
      });
      expect(prisma.user.create.mock.calls[0][0].data.locale).toBe('en');

      await service.register({
        email: 'default@example.com',
        password: 'password123',
        name: 'Default User',
      });
      expect(prisma.user.create.mock.calls[1][0].data.locale).toBe('vi');
    });

    it('chỉ trả đúng field của AuthUser (allowlist): không lọt hash, token reset, accountStatus', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        ...baseUser,
        passwordHash: 'bcrypt-hash',
        refreshTokenHash: 'refresh-hash',
        locale: 'en',
        emailVerificationTokenHash: 'verify-hash',
        passwordResetTokenHash: 'reset-hash',
        passwordResetExpiresAt: new Date(),
        passwordResetSentAt: new Date(),
      });

      const result = await service.register({
        email: 'new@example.com',
        password: 'password123',
        name: 'New User',
      });

      expect(Object.keys(result.user).sort()).toEqual(
        [
          'email',
          'emailVerifiedAt',
          'hasPassword',
          'id',
          'locale',
          'name',
          'role',
        ].sort(),
      );
      expect(result.user.locale).toBe('en');
      expect(JSON.stringify(result.user)).not.toMatch(/hash/i);
    });

    it('email xác thực theo ngôn ngữ người đăng ký: en ⇒ link có prefix /en và template nhận locale en', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseUser, ...data }),
      );

      await service.register({
        email: 'en@example.com',
        password: 'password123',
        name: 'English User',
        locale: 'en',
      });

      expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
        'en@example.com',
        'English User',
        expect.stringMatching(
          /^http:\/\/localhost:3000\/en\/verify-email\?token=[0-9a-f]{64}$/,
        ),
        'en',
      );
    });

    it('email xác thực mặc định vi: link KHÔNG có prefix', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseUser, ...data }),
      );

      await service.register({
        email: 'vi@example.com',
        password: 'password123',
        name: 'Người Việt',
      });

      expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
        'vi@example.com',
        'Người Việt',
        expect.stringMatching(
          /^http:\/\/localhost:3000\/verify-email\?token=[0-9a-f]{64}$/,
        ),
        'vi',
      );
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
        'vi',
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

    // accountStatus là session-level (khác emailVerifiedAt) — tài khoản bị
    // khoá không được cấp JWT mới dù đúng mật khẩu. Xem
    // .claude/docs/auth-shop-status-architecture.md.
    it.each([
      AccountStatus.SUSPENDED,
      AccountStatus.BANNED,
      AccountStatus.DEACTIVATED,
    ])(
      'báo lỗi 401 ACCOUNT_NOT_ACTIVE nếu accountStatus là %s',
      async (accountStatus: AccountStatus) => {
        const passwordHash = await bcrypt.hash('correct-password', 10);
        prisma.user.findUnique.mockResolvedValue({
          ...baseUser,
          accountStatus,
          passwordHash,
        });

        await expect(
          service.login({
            email: baseUser.email,
            password: 'correct-password',
          }),
        ).rejects.toMatchObject({
          status: 401,
          code: 'ACCOUNT_NOT_ACTIVE',
          message: 'ACCOUNT_NOT_ACTIVE',
        });
        expect(prisma.user.update).not.toHaveBeenCalled();
      },
    );

    // Tài khoản chỉ đăng ký qua Google (loginWithGoogle) có passwordHash =
    // null — cố login bằng password phải báo lỗi giống hệt sai mật khẩu
    // thường, không được lộ ra rằng tài khoản này dùng OAuth.
    it('báo lỗi 401 (message giống sai mật khẩu) nếu tài khoản chỉ đăng ký qua OAuth (passwordHash null)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash: null,
      });

      await expect(
        service.login({ email: baseUser.email, password: 'any-password' }),
      ).rejects.toMatchObject(
        new UnauthorizedException('Email hoặc mật khẩu không đúng'),
      );
    });
  });

  describe('loginWithGoogle', () => {
    const googleProfile = {
      googleId: 'google-sub-123',
      email: 'new-google-user@example.com',
      name: 'Google User',
    };

    it('tạo user mới + OAuthAccount nếu chưa từng đăng nhập Google và email chưa tồn tại', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null); // check email đã tồn tại chưa
      prisma.user.create.mockResolvedValue({
        ...baseUser,
        id: 'new-user-id',
        email: googleProfile.email,
        name: googleProfile.name,
        passwordHash: null,
        emailVerifiedAt: new Date(),
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.loginWithGoogle(googleProfile);

      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs.data.email).toBe(googleProfile.email);
      expect(createArgs.data.name).toBe(googleProfile.name);
      expect(createArgs.data.passwordHash).toBeNull();
      expect(createArgs.data.emailVerifiedAt).toBeInstanceOf(Date);
      expect(createArgs.data.oauthAccounts).toEqual({
        create: {
          provider: OAuthProvider.GOOGLE,
          providerUserId: googleProfile.googleId,
        },
      });
      expect(result.accessToken).toBeDefined();
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('đăng nhập thẳng nếu OAuthAccount đã tồn tại (không tạo user/account mới)', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue({
        id: 'oauth-1',
        provider: OAuthProvider.GOOGLE,
        providerUserId: googleProfile.googleId,
        userId: baseUser.id,
        user: { ...baseUser },
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.loginWithGoogle(googleProfile);

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.oAuthAccount.create).not.toHaveBeenCalled();
      expect(result.accessToken).toBeDefined();
    });

    it('liên kết Google vào user đã tồn tại theo email (đăng ký bằng password trước đó), tự set emailVerifiedAt nếu chưa verify', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        emailVerifiedAt: null,
      });
      prisma.oAuthAccount.create.mockResolvedValue({});
      prisma.user.update.mockResolvedValue({
        ...baseUser,
        emailVerifiedAt: new Date(),
      });

      await service.loginWithGoogle({
        ...googleProfile,
        email: baseUser.email,
      });

      expect(prisma.oAuthAccount.create).toHaveBeenCalledWith({
        data: {
          userId: baseUser.id,
          provider: OAuthProvider.GOOGLE,
          providerUserId: googleProfile.googleId,
        },
      });
      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: baseUser.id });
      expect(updateArgs.data.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('báo lỗi 401 ACCOUNT_NOT_ACTIVE nếu tài khoản Google liên kết tới đã bị khoá', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue({
        id: 'oauth-1',
        provider: OAuthProvider.GOOGLE,
        providerUserId: googleProfile.googleId,
        userId: baseUser.id,
        user: { ...baseUser, accountStatus: AccountStatus.SUSPENDED },
      });

      await expect(
        service.loginWithGoogle(googleProfile),
      ).rejects.toMatchObject({
        status: 401,
        code: 'ACCOUNT_NOT_ACTIVE',
        message: 'ACCOUNT_NOT_ACTIVE',
      });
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

    it('hasPassword = true khi tài khoản có mật khẩu, false khi chỉ đăng nhập Google (passwordHash null)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash: 'bcrypt-hash',
      });
      expect((await service.me(baseUser.id)).user.hasPassword).toBe(true);

      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash: null,
      });
      const googleOnly = await service.me(baseUser.id);
      expect(googleOnly.user.hasPassword).toBe(false);
      expect(googleOnly.user).not.toHaveProperty('passwordHash');
    });

    it('không lộ 3 cột reset mật khẩu dù DB đang giữ token chờ', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash: 'bcrypt-hash',
        passwordResetTokenHash: 'a'.repeat(64),
        passwordResetExpiresAt: new Date(),
        passwordResetSentAt: new Date(),
      });

      const { user } = await service.me(baseUser.id);

      expect(user).not.toHaveProperty('passwordResetTokenHash');
      expect(user).not.toHaveProperty('passwordResetExpiresAt');
      expect(user).not.toHaveProperty('passwordResetSentAt');
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

    it('token không khớp user nào ⇒ 400 VERIFY_TOKEN_INVALID', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expectAppException(service.verifyEmail('token-khong-ton-tai'), {
        status: 400,
        code: 'VERIFY_TOKEN_INVALID',
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('token đã hết hạn ⇒ CÙNG mã VERIFY_TOKEN_INVALID với token sai (không lộ token từng tồn tại hay không)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        emailVerificationTokenHash: createHash('sha256')
          .update('expired-raw-token')
          .digest('hex'),
        emailVerificationExpiresAt: new Date(Date.now() - 1000),
      });

      await expectAppException(service.verifyEmail('expired-raw-token'), {
        status: 400,
        code: 'VERIFY_TOKEN_INVALID',
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('user khớp hash nhưng không có hạn (dữ liệu hỏng) ⇒ coi như token không hợp lệ, không xác thực', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        emailVerificationTokenHash: createHash('sha256')
          .update('no-expiry-token')
          .digest('hex'),
        emailVerificationExpiresAt: null,
      });

      await expectAppException(service.verifyEmail('no-expiry-token'), {
        status: 400,
        code: 'VERIFY_TOKEN_INVALID',
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('resendVerification', () => {
    it('email đã được xác thực ⇒ 400 EMAIL_ALREADY_VERIFIED', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        emailVerifiedAt: new Date(),
      });

      await expectAppException(service.resendVerification(baseUser.id), {
        status: 400,
        code: 'EMAIL_ALREADY_VERIFIED',
      });
      expect(mailService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('gửi lại quá nhanh (còn trong cooldown) ⇒ 429 VERIFICATION_RESEND_TOO_SOON', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        emailVerificationSentAt: new Date(
          Date.now() - EMAIL_VERIFICATION_RESEND_COOLDOWN_MS / 2,
        ),
      });

      await expectAppException(service.resendVerification(baseUser.id), {
        status: 429,
        code: 'VERIFICATION_RESEND_TOO_SOON',
      });
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
        'vi',
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

  // --- Hồ sơ và mật khẩu (Week9.md 1.11/5.4). Luồng đầy đủ với DB thật nằm ở
  // auth-password.controller.int-spec.ts; ở đây khoá các quyết định của service bằng mock.

  describe('issueTokens — refresh token luôn duy nhất', () => {
    it('hai lần đăng nhập trong CÙNG một giây cho refresh token KHÁC nhau (jti ngẫu nhiên)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash: await bcrypt.hash('password123', 4),
      });
      prisma.user.update.mockResolvedValue({});

      const first = await service.login({
        email: baseUser.email,
        password: 'password123',
      });
      const second = await service.login({
        email: baseUser.email,
        password: 'password123',
      });

      expect(first.refreshToken).not.toBe(second.refreshToken);
    });
  });

  describe('updateProfile', () => {
    it('chỉ ghi name và locale, đúng where theo userId', async () => {
      prisma.user.update.mockResolvedValue({
        ...baseUser,
        name: 'Tên mới',
        locale: 'en',
      });

      const result = await service.updateProfile('user-1', {
        name: 'Tên mới',
        locale: 'en',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: 'Tên mới', locale: 'en' },
      });
      expect(result.user).toMatchObject({ name: 'Tên mới', locale: 'en' });
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('chỉ gửi locale thì data không có name (cập nhật từng phần)', async () => {
      prisma.user.update.mockResolvedValue({ ...baseUser, locale: 'en' });

      await service.updateProfile('user-1', { locale: 'en' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { locale: 'en' },
      });
    });

    it('user đã bị xoá giữa chừng (P2025) ⇒ 401, không phải 500', async () => {
      prisma.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.updateProfile('gone', { name: 'A' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('changePassword', () => {
    const OLD = 'old-password-1';
    let oldHash: string;

    beforeEach(async () => {
      oldHash = await bcrypt.hash(OLD, 4);
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash: oldHash,
      });
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.update.mockResolvedValue({});
      mailService.sendPasswordChanged.mockResolvedValue(undefined);
    });

    it('thành công: UPDATE có điều kiện theo hash vừa xác minh, xoá token reset, cấp lại token, gửi 1 email bảo mật', async () => {
      const result = await service.changePassword('user-1', {
        currentPassword: OLD,
        newPassword: 'new-password-2',
      });

      const [args] = prisma.user.updateMany.mock.calls[0] as [
        {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        },
      ];
      expect(args.where).toEqual({ id: 'user-1', passwordHash: oldHash });
      expect(args.data).toMatchObject({
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        passwordResetSentAt: null,
      });
      expect(
        await bcrypt.compare(
          'new-password-2',
          args.data.passwordHash as string,
        ),
      ).toBe(true);
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toEqual(expect.any(String));
      expect(mailService.sendPasswordChanged).toHaveBeenCalledTimes(1);
      expect(mailService.sendPasswordChanged).toHaveBeenCalledWith(
        baseUser.email,
        expect.objectContaining({
          locale: 'vi',
          name: baseUser.name,
          forgotPasswordUrl: expect.stringContaining(
            '/forgot-password',
          ) as string,
        }),
      );
    });

    it('sai mật khẩu hiện tại ⇒ CURRENT_PASSWORD_INCORRECT, không ghi, không gửi mail', async () => {
      await expect(
        service.changePassword('user-1', {
          currentPassword: 'wrong',
          newPassword: 'new-password-2',
        }),
      ).rejects.toMatchObject({
        code: 'CURRENT_PASSWORD_INCORRECT',
        status: 400,
      });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(mailService.sendPasswordChanged).not.toHaveBeenCalled();
    });

    it('tài khoản chưa có mật khẩu ⇒ PASSWORD_NOT_SET', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash: null,
      });

      await expect(
        service.changePassword('user-1', {
          currentPassword: OLD,
          newPassword: 'new-password-2',
        }),
      ).rejects.toMatchObject({ code: 'PASSWORD_NOT_SET', status: 400 });
    });

    it('mật khẩu bị đổi giữa chừng bởi luồng khác (count = 0) ⇒ KHÔNG ghi đè, báo sai mật khẩu hiện tại', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.changePassword('user-1', {
          currentPassword: OLD,
          newPassword: 'new-password-2',
        }),
      ).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INCORRECT' });
      expect(mailService.sendPasswordChanged).not.toHaveBeenCalled();
    });

    it('gửi mail lỗi không làm hỏng request', async () => {
      mailService.sendPasswordChanged.mockRejectedValue(new Error('Resend'));

      await expect(
        service.changePassword('user-1', {
          currentPassword: OLD,
          newPassword: 'new-password-2',
        }),
      ).resolves.toMatchObject({ message: expect.any(String) as string });
    });

    it('user không còn tồn tại ⇒ 401', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changePassword('gone', {
          currentPassword: OLD,
          newPassword: 'new-password-2',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('forgotPassword', () => {
    // Mail gửi KHÔNG chờ (chống dò email qua thời gian) nên phải đợi microtask/timer xong mới khẳng định.
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    const DTO = { email: 'user@example.com' };

    beforeEach(() => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      mailService.sendPasswordReset.mockResolvedValue(undefined);
    });

    it('user ACTIVE: ghi hash (không ghi token thô) bằng UPDATE có điều kiện cooldown, gửi 1 mail có link', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser });

      const result = await service.forgotPassword(DTO);
      await flush();

      expect(result.message).toBe(FORGOT_PASSWORD_MESSAGE);
      const [args] = prisma.user.updateMany.mock.calls[0] as [
        {
          where: { id: string; OR: unknown[] };
          data: {
            passwordResetTokenHash: string;
            passwordResetExpiresAt: Date;
            passwordResetSentAt: Date;
          };
        },
      ];
      expect(args.where.id).toBe('user-1');
      expect(args.where.OR).toHaveLength(2); // sentAt null HOẶC cũ hơn cooldown
      expect(args.data.passwordResetTokenHash).toMatch(/^[0-9a-f]{64}$/);
      const ttlMs = args.data.passwordResetExpiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(59 * 60_000);
      expect(ttlMs).toBeLessThanOrEqual(60 * 60_000);

      expect(mailService.sendPasswordReset).toHaveBeenCalledTimes(1);
      const [to, data] = mailService.sendPasswordReset.mock.calls[0] as [
        string,
        { resetUrl: string; expiresInMinutes: number },
      ];
      expect(to).toBe('user@example.com');
      expect(data.expiresInMinutes).toBe(60);
      const rawToken = /token=([0-9a-f]{64})/.exec(data.resetUrl)?.[1];
      expect(rawToken).toBeDefined();
      expect(createHash('sha256').update(rawToken!).digest('hex')).toBe(
        args.data.passwordResetTokenHash,
      );
      expect(args.data.passwordResetTokenHash).not.toBe(rawToken);
    });

    it('PASSWORD_RESET_TTL_MINUTES đọc LÚC DÙNG, kẹp tối đa 24 giờ, giá trị rỗng/sai ⇒ 60', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser });
      const ttlOf = async (value: string | undefined) => {
        if (value === undefined) delete process.env.PASSWORD_RESET_TTL_MINUTES;
        else process.env.PASSWORD_RESET_TTL_MINUTES = value;
        mailService.sendPasswordReset.mockClear();
        await service.forgotPassword(DTO);
        await flush();
        const [, data] = mailService.sendPasswordReset.mock.calls[0] as [
          string,
          { expiresInMinutes: number },
        ];
        return data.expiresInMinutes;
      };

      try {
        expect(await ttlOf('15')).toBe(15);
        expect(await ttlOf('999999')).toBe(1440);
        expect(await ttlOf('')).toBe(60);
        expect(await ttlOf('abc')).toBe(60);
        expect(await ttlOf(undefined)).toBe(60);
      } finally {
        delete process.env.PASSWORD_RESET_TTL_MINUTES;
      }
    });

    it('email không có tài khoản: cùng phản hồi, không ghi, không gửi', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword(DTO);
      await flush();

      expect(result.message).toBe(FORGOT_PASSWORD_MESSAGE);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(mailService.sendPasswordReset).not.toHaveBeenCalled();
    });

    it.each([
      AccountStatus.SUSPENDED,
      AccountStatus.BANNED,
      AccountStatus.DEACTIVATED,
    ])(
      'tài khoản %s: cùng phản hồi, không ghi, không gửi',
      async (accountStatus) => {
        prisma.user.findUnique.mockResolvedValue({
          ...baseUser,
          accountStatus,
        });

        const result = await service.forgotPassword(DTO);
        await flush();

        expect(result.message).toBe(FORGOT_PASSWORD_MESSAGE);
        expect(prisma.user.updateMany).not.toHaveBeenCalled();
        expect(mailService.sendPasswordReset).not.toHaveBeenCalled();
      },
    );

    it('đang trong cooldown (UPDATE có điều kiện trả count = 0): cùng phản hồi, KHÔNG gửi mail', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser });
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.forgotPassword(DTO);
      await flush();

      expect(result.message).toBe(FORGOT_PASSWORD_MESSAGE);
      expect(mailService.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('mail lỗi: vẫn trả phản hồi bình thường, lỗi được log chứ không ném', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser });
      mailService.sendPasswordReset.mockRejectedValue(new Error('Resend'));

      await expect(service.forgotPassword(DTO)).resolves.toEqual({
        message: FORGOT_PASSWORD_MESSAGE,
      });
      await flush();
    });

    it('mail theo ngôn ngữ của user (en) và link có /en', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, locale: 'en' });

      await service.forgotPassword(DTO);
      await flush();

      const [, data] = mailService.sendPasswordReset.mock.calls[0] as [
        string,
        { locale: string; resetUrl: string },
      ];
      expect(data.locale).toBe('en');
      expect(data.resetUrl).toContain('/en/reset-password?token=');
    });
  });

  describe('resetPassword', () => {
    const TOKEN = 'a'.repeat(64);
    const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');
    const pending = () => ({
      ...baseUser,
      passwordResetTokenHash: TOKEN_HASH,
      passwordResetExpiresAt: new Date(Date.now() + 30 * 60_000),
    });

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(pending());
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      mailService.sendPasswordChanged.mockResolvedValue(undefined);
    });

    it('tra theo HASH của token, đặt mật khẩu bcrypt, xoá 3 cột token, thu hồi refresh token, gửi 1 email bảo mật', async () => {
      const result = await service.resetPassword({
        token: TOKEN,
        newPassword: 'new-password-2',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { passwordResetTokenHash: TOKEN_HASH },
      });
      const [args] = prisma.user.updateMany.mock.calls[0] as [
        {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        },
      ];
      expect(args.where).toMatchObject({
        id: 'user-1',
        passwordResetTokenHash: TOKEN_HASH,
        accountStatus: AccountStatus.ACTIVE,
      });
      expect(args.where.passwordResetExpiresAt).toEqual({
        gt: expect.any(Date) as Date,
      });
      expect(args.data).toMatchObject({
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        passwordResetSentAt: null,
        refreshTokenHash: null,
      });
      expect(args.data.passwordHash).not.toBe('new-password-2');
      expect(
        await bcrypt.compare(
          'new-password-2',
          args.data.passwordHash as string,
        ),
      ).toBe(true);
      expect(result.message).toBeDefined();
      expect(mailService.sendPasswordChanged).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['không tìm thấy token', null],
      [
        'token hết hạn',
        {
          ...baseUser,
          passwordResetTokenHash: TOKEN_HASH,
          passwordResetExpiresAt: new Date(Date.now() - 1000),
        },
      ],
      [
        'tài khoản không còn ACTIVE',
        {
          ...baseUser,
          accountStatus: AccountStatus.SUSPENDED,
          passwordResetTokenHash: TOKEN_HASH,
          passwordResetExpiresAt: new Date(Date.now() + 60_000),
        },
      ],
    ])(
      '%s ⇒ RESET_TOKEN_INVALID, không ghi, không gửi mail',
      async (_label, row) => {
        prisma.user.findUnique.mockResolvedValue(row);

        await expect(
          service.resetPassword({
            token: TOKEN,
            newPassword: 'new-password-2',
          }),
        ).rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID', status: 400 });
        expect(prisma.user.updateMany).not.toHaveBeenCalled();
        expect(mailService.sendPasswordChanged).not.toHaveBeenCalled();
      },
    );

    it('thua cuộc đua dùng một lần (count = 0) ⇒ RESET_TOKEN_INVALID, không gửi mail', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.resetPassword({ token: TOKEN, newPassword: 'new-password-2' }),
      ).rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID' });
      expect(mailService.sendPasswordChanged).not.toHaveBeenCalled();
    });

    it('mail lỗi không làm hỏng việc đặt lại', async () => {
      mailService.sendPasswordChanged.mockRejectedValue(new Error('Resend'));

      await expect(
        service.resetPassword({ token: TOKEN, newPassword: 'new-password-2' }),
      ).resolves.toMatchObject({ message: expect.any(String) as string });
    });
  });

  // Thu hồi phiên ⇒ ngắt mọi kết nối real-time của người dùng (Week10.md 3.3). Best-effort: lỗi đẩy không được
  // làm hỏng đăng xuất/đổi/đặt lại mật khẩu, và chỉ ngắt SAU KHI DB đã ghi xong.
  describe('ngắt kết nối real-time khi thu hồi phiên', () => {
    const OLD = 'old-password-1';
    const TOKEN = 'a'.repeat(64);
    const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');
    let errorLog: jest.SpyInstance;

    beforeEach(() => {
      errorLog = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      prisma.user.update.mockResolvedValue({});
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      mailService.sendPasswordChanged.mockResolvedValue(undefined);
    });

    afterEach(() => {
      errorLog.mockRestore();
    });

    const arrangeChange = async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash: await bcrypt.hash(OLD, 4),
      });
    };
    const change = (currentPassword = OLD) =>
      service.changePassword('user-1', {
        currentPassword,
        newPassword: 'new-password-2',
      });
    const arrangeReset = (overrides: Record<string, unknown> = {}) => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordResetTokenHash: TOKEN_HASH,
        passwordResetExpiresAt: new Date(Date.now() + 30 * 60_000),
        ...overrides,
      });
    };
    const reset = () =>
      service.resetPassword({ token: TOKEN, newPassword: 'new-password-2' });

    describe('logout', () => {
      it('ngắt kết nối của đúng người dùng đó, SAU khi đã xoá refresh token trong DB', async () => {
        const order: string[] = [];
        prisma.user.update.mockImplementation(() => {
          order.push('db');
          return Promise.resolve({});
        });
        jest.spyOn(realtime, 'disconnectUser').mockImplementation((id) => {
          order.push(`disconnect:${id}`);
          return Promise.resolve();
        });

        await service.logout('user-1');

        expect(order).toEqual(['db', 'disconnect:user-1']);
      });

      it('DB lỗi ⇒ ném lỗi và KHÔNG ngắt kết nối (phiên chưa thật sự bị thu hồi)', async () => {
        prisma.user.update.mockRejectedValue(new Error('db down'));

        await expect(service.logout('user-1')).rejects.toThrow('db down');

        expect(realtime.disconnected).toEqual([]);
      });

      it('đẩy real-time lỗi ⇒ đăng xuất VẪN thành công, chỉ log id', async () => {
        realtime.failWith(new Error('socket down'));

        await expect(service.logout('user-1')).resolves.toBeUndefined();

        expect(errorLog).toHaveBeenCalledTimes(1);
        const logged = JSON.stringify(errorLog.mock.calls);
        expect(logged).toContain('user-1');
        expect(logged).toContain('socket down');
      });
    });

    describe('changePassword', () => {
      it('thành công ⇒ ngắt mọi kết nối của người dùng, vẫn cấp token mới cho phiên hiện tại và gửi mail', async () => {
        await arrangeChange();

        const result = await change();

        expect(realtime.disconnected).toEqual(['user-1']);
        expect(result.accessToken).toEqual(expect.any(String));
        expect(mailService.sendPasswordChanged).toHaveBeenCalledTimes(1);
      });

      it('sai mật khẩu hiện tại ⇒ KHÔNG ngắt kết nối của ai', async () => {
        await arrangeChange();

        await expect(change('wrong')).rejects.toMatchObject({
          code: 'CURRENT_PASSWORD_INCORRECT',
        });

        expect(realtime.disconnected).toEqual([]);
      });

      it('tài khoản chưa có mật khẩu / mật khẩu bị đổi giữa chừng (count = 0) ⇒ KHÔNG ngắt', async () => {
        prisma.user.findUnique.mockResolvedValue({
          ...baseUser,
          passwordHash: null,
        });
        await expect(change()).rejects.toMatchObject({
          code: 'PASSWORD_NOT_SET',
        });

        await arrangeChange();
        prisma.user.updateMany.mockResolvedValue({ count: 0 });
        await expect(change()).rejects.toMatchObject({
          code: 'CURRENT_PASSWORD_INCORRECT',
        });

        expect(realtime.disconnected).toEqual([]);
      });

      it('đẩy real-time lỗi ⇒ đổi mật khẩu VẪN thành công, vẫn có token và vẫn gửi mail', async () => {
        await arrangeChange();
        realtime.failWith();

        const result = await change();

        expect(result.accessToken).toEqual(expect.any(String));
        expect(result.refreshToken).toEqual(expect.any(String));
        expect(mailService.sendPasswordChanged).toHaveBeenCalledTimes(1);
        expect(errorLog).toHaveBeenCalledTimes(1);
      });
    });

    describe('resetPassword', () => {
      it('thành công ⇒ ngắt mọi kết nối của chủ tài khoản (id lấy từ DB, không từ client) và vẫn gửi mail', async () => {
        arrangeReset();

        await reset();

        expect(realtime.disconnected).toEqual(['user-1']);
        expect(mailService.sendPasswordChanged).toHaveBeenCalledTimes(1);
      });

      it.each([
        [
          'không tìm thấy token',
          () => prisma.user.findUnique.mockResolvedValue(null),
        ],
        [
          'token hết hạn',
          () =>
            arrangeReset({
              passwordResetExpiresAt: new Date(Date.now() - 1000),
            }),
        ],
        [
          'tài khoản không còn ACTIVE',
          () => arrangeReset({ accountStatus: AccountStatus.SUSPENDED }),
        ],
        [
          'token đã bị dùng giữa chừng (count = 0)',
          () => {
            arrangeReset();
            prisma.user.updateMany.mockResolvedValue({ count: 0 });
          },
        ],
      ])(
        '%s ⇒ RESET_TOKEN_INVALID và KHÔNG ngắt kết nối của ai',
        async (_name, arrange) => {
          arrange();

          await expect(reset()).rejects.toMatchObject({
            code: 'RESET_TOKEN_INVALID',
          });

          expect(realtime.disconnected).toEqual([]);
        },
      );

      it('đẩy real-time lỗi ⇒ đặt lại mật khẩu VẪN thành công và vẫn gửi mail', async () => {
        arrangeReset();
        realtime.failWith();

        await expect(reset()).resolves.toMatchObject({
          message: expect.any(String) as string,
        });

        expect(mailService.sendPasswordChanged).toHaveBeenCalledTimes(1);
        expect(errorLog).toHaveBeenCalledTimes(1);
      });
    });
  });
});
