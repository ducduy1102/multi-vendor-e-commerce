import type { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { registerSchema } from '@ecommerce/types';

// Cùng cost với AuthService (SALT_ROUNDS) — hash này phải so khớp được bởi bcrypt.compare lúc login.
const SALT_ROUNDS = 10;

const ADMIN_NAME = 'Admin';

// Dùng đúng luật email/mật khẩu của đăng ký (chuẩn hoá email về chữ thường — AuthService cũng
// chuẩn hoá lúc register/login, nếu seed lưu nguyên chữ HOA thì admin không đăng nhập được).
const seedAdminSchema = registerSchema.pick({ email: true, password: true });

export interface SeedAdminConfig {
  email: string;
  password: string;
}

// Không hard-code tài khoản/mật khẩu admin trong repo (Week8.md 1.8). Thiếu CẢ HAI biến = không có ý
// định tạo admin ⇒ null (bỏ qua). Chỉ có 1 trong 2 hoặc giá trị sai luật ⇒ ném lỗi rõ ràng, vì người
// vận hành đã có ý tạo admin mà âm thầm bỏ qua sẽ chỉ lộ ra khi không đăng nhập được. Không đưa giá
// trị mật khẩu vào thông báo lỗi.
export function readSeedAdminConfig(
  env: NodeJS.ProcessEnv,
): SeedAdminConfig | null {
  const email = env.SEED_ADMIN_EMAIL?.trim();
  const password = env.SEED_ADMIN_PASSWORD;
  if (!email && !password) {
    return null;
  }
  if (!email || !password) {
    throw new Error(
      'SEED_ADMIN_EMAIL và SEED_ADMIN_PASSWORD phải được khai cùng nhau (đang thiếu một trong hai).',
    );
  }

  const parsed = seedAdminSchema.safeParse({ email, password });
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join('.'))),
    ].join(', ');
    throw new Error(
      `SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD không hợp lệ (field sai: ${fields}). Mật khẩu 8-72 ký tự, email đúng định dạng.`,
    );
  }
  return parsed.data;
}

export type SeedAdminResult = 'created' | 'promoted' | 'unchanged';

// Idempotent: chạy lại không tạo trùng và KHÔNG đụng mật khẩu/trạng thái của tài khoản đã có (admin có
// thể đã đổi mật khẩu). Email đã có nhưng đang là USER ⇒ nâng lên ADMIN — chủ ý, vì email này do chính
// người vận hành khai trong ENV (cùng hiệu quả với `UPDATE users SET role='ADMIN'` tay). Tài khoản mới
// được coi là đã xác thực email (tin cậy vì do người vận hành cấp, không có hộp thư để bấm link).
export async function seedAdmin(
  prisma: PrismaClient,
  config: SeedAdminConfig,
): Promise<SeedAdminResult> {
  const existing = await prisma.user.findUnique({
    where: { email: config.email },
    select: { id: true, role: true },
  });

  if (!existing) {
    await prisma.user.create({
      data: {
        email: config.email,
        passwordHash: await bcrypt.hash(config.password, SALT_ROUNDS),
        name: ADMIN_NAME,
        role: 'ADMIN',
        emailVerifiedAt: new Date(),
      },
    });
    return 'created';
  }

  if (existing.role !== 'ADMIN') {
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: 'ADMIN' },
    });
    return 'promoted';
  }
  return 'unchanged';
}
