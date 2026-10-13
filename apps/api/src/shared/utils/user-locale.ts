import { DEFAULT_MAIL_LOCALE, type MailLocale } from '../mail/mail-locale';
import type { PrismaService } from '../prisma/prisma.service';

// Ngôn ngữ ưa thích của user (`User.locale`, Week9.md 1.12) cho những nơi chỉ có `userId` trong tay — hiện là
// ngôn ngữ trang thanh toán của cổng (VNPay `vnp_Locale`). Chỉ phục vụ trình bày: lỗi đọc/user không còn thì
// rơi về mặc định thay vì làm hỏng việc chính (tạo link thanh toán).
export async function findUserLocale(
  prisma: Pick<PrismaService, 'user'>,
  userId: string,
): Promise<MailLocale> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    return user?.locale ?? DEFAULT_MAIL_LOCALE;
  } catch {
    return DEFAULT_MAIL_LOCALE;
  }
}
