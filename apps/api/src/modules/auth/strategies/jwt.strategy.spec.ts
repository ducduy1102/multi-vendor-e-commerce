import { UnauthorizedException } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  });

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    strategy = new JwtStrategy(prisma as unknown as PrismaService);
  });

  it('trả về AuthenticatedUser nếu tài khoản đang ACTIVE', async () => {
    prisma.user.findUnique.mockResolvedValue({
      accountStatus: AccountStatus.ACTIVE,
      role: Role.USER,
    });

    await expect(
      strategy.validate({ sub: 'user-1', role: Role.USER }),
    ).resolves.toEqual({ userId: 'user-1', role: Role.USER });
  });

  it('role lấy từ DB, không phải payload: token cấp khi còn USER nhưng DB đã nâng lên ADMIN ⇒ ADMIN', async () => {
    prisma.user.findUnique.mockResolvedValue({
      accountStatus: AccountStatus.ACTIVE,
      role: Role.ADMIN,
    });

    await expect(
      strategy.validate({ sub: 'user-1', role: Role.USER }),
    ).resolves.toEqual({ userId: 'user-1', role: Role.ADMIN });
  });

  it('role lấy từ DB, không phải payload: token cấp khi còn ADMIN nhưng DB đã hạ xuống USER ⇒ USER', async () => {
    prisma.user.findUnique.mockResolvedValue({
      accountStatus: AccountStatus.ACTIVE,
      role: Role.USER,
    });

    await expect(
      strategy.validate({ sub: 'user-1', role: Role.ADMIN }),
    ).resolves.toEqual({ userId: 'user-1', role: Role.USER });
  });

  it('đọc role trong CÙNG một truy vấn với accountStatus (không thêm lượt DB nào mỗi request)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      accountStatus: AccountStatus.ACTIVE,
      role: Role.USER,
    });

    await strategy.validate({ sub: 'user-1', role: Role.USER });

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { accountStatus: true, role: true },
    });
  });

  it('báo lỗi 401 ACCOUNT_NOT_ACTIVE nếu tài khoản bị SUSPENDED (JWT cũ đã cấp trước khi bị khoá)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      accountStatus: AccountStatus.SUSPENDED,
      role: Role.USER,
    });

    await expect(
      strategy.validate({ sub: 'user-1', role: Role.USER }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'ACCOUNT_NOT_ACTIVE',
      message: 'ACCOUNT_NOT_ACTIVE',
    });
  });

  it('báo lỗi 401 nếu user không còn tồn tại (đã bị xoá sau khi token issue)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'deleted-user', role: Role.USER }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
