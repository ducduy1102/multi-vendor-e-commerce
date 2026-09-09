import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

// @Roles(Role.ADMIN) trên route — RolesGuard đọc lại metadata này để check.
// Không tự check role thủ công trong service (rules/backend.md mục 5).
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
