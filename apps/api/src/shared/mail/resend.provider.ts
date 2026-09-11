import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import type { MailMessage, MailProvider } from './mail-provider.interface';

// Dev/test dùng domain mặc định onboarding@resend.dev (chưa cần verify domain
// riêng) — production phải verify domain qua DNS DKIM/SPF rồi đổi MAIL_FROM.
@Injectable()
export class ResendMailProvider implements MailProvider {
  private readonly logger = new Logger(ResendMailProvider.name);
  private readonly from = process.env.MAIL_FROM ?? 'onboarding@resend.dev';
  private client: Resend | null = null;

  // Khởi tạo lazy (không phải ở field initializer/constructor) — SDK Resend
  // throw ngay tại `new Resend()` nếu thiếu API key. Khởi tạo eager từng làm
  // sập cả app lúc bootstrap (ResendMailProvider là provider của MailModule,
  // MailModule lại được AuthModule import) chỉ vì thiếu RESEND_API_KEY, dù
  // AuthService.sendVerificationEmailSafely() đã bọc try/catch để lỗi gửi
  // mail không làm hỏng request — lỗi phải xảy ra (và bị catch) lúc gọi
  // send(), không phải lúc app khởi động.
  private getClient(): Resend {
    if (!this.client) {
      this.client = new Resend(process.env.RESEND_API_KEY);
    }
    return this.client;
  }

  async send(message: MailMessage): Promise<void> {
    const { error } = await this.getClient().emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
    });

    if (error) {
      this.logger.error(`Gửi email thất bại: ${error.message}`);
      throw new Error(`Gửi email thất bại: ${error.message}`);
    }
  }
}
