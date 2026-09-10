import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../../modules/auth/types/jwt-payload.type';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  function createContext(user?: AuthenticatedUser): ExecutionContext {
    return {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  function createGuard(requiredRoles: Role[] | undefined): RolesGuard {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  }

  it('cho qua nếu route không gắn @Roles()', () => {
    const guard = createGuard(undefined);

    expect(
      guard.canActivate(createContext({ userId: 'u1', role: Role.USER })),
    ).toBe(true);
  });

  it('cho qua nếu role của user nằm trong danh sách @Roles() yêu cầu', () => {
    const guard = createGuard([Role.ADMIN]);

    expect(
      guard.canActivate(createContext({ userId: 'u1', role: Role.ADMIN })),
    ).toBe(true);
  });

  it('chặn nếu role của user không nằm trong danh sách @Roles() yêu cầu', () => {
    const guard = createGuard([Role.ADMIN]);

    expect(
      guard.canActivate(createContext({ userId: 'u1', role: Role.USER })),
    ).toBe(false);
  });

  it('chặn nếu request chưa có user (guard đặt sai thứ tự, thiếu JwtAuthGuard trước đó)', () => {
    const guard = createGuard([Role.ADMIN]);

    expect(guard.canActivate(createContext(undefined))).toBe(false);
  });
});
