import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { EmailVerifiedGuard } from './email-verified.guard';
import { PrismaService } from '../prisma/prisma.service';

function createContext(user?: {
  userId: string;
  role: string;
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('EmailVerifiedGuard', () => {
  let guard: EmailVerifiedGuard;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    guard = new EmailVerifiedGuard(prisma as unknown as PrismaService);
  });

  it('chặn nếu không có req.user (guard đặt sai thứ tự, thiếu JwtAuthGuard trước đó)', async () => {
    await expect(guard.canActivate(createContext(undefined))).resolves.toBe(
      false,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('cho qua nếu user đã verify email', async () => {
    prisma.user.findUnique.mockResolvedValue({ emailVerifiedAt: new Date() });

    await expect(
      guard.canActivate(createContext({ userId: 'user-1', role: 'USER' })),
    ).resolves.toBe(true);
  });

  it('báo lỗi 403 EMAIL_NOT_VERIFIED nếu chưa verify email', async () => {
    prisma.user.findUnique.mockResolvedValue({ emailVerifiedAt: null });

    await expect(
      guard.canActivate(createContext({ userId: 'user-1', role: 'USER' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('báo lỗi 403 nếu user không còn tồn tại trong DB', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        createContext({ userId: 'deleted-user', role: 'USER' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
