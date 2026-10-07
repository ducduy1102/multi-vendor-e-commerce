import type {
  MailMessage,
  MailProvider,
} from '../mail/mail-provider.interface';
import { MailService } from '../mail/mail.service';

// MailProvider GIẢ cho integration/e2e test: ghi lại mọi email "đã gửi" để assert nội dung, và có thể
// bật chế độ lỗi để chứng minh mail lỗi không làm hỏng hành động. LUÔN dùng trong test chạy luồng có
// gửi email — không thì ResendMailProvider thật sẽ gọi mạng nếu máy có RESEND_API_KEY (Prisma nạp
// `.env` vào process.env), gửi tới địa chỉ *.test.local.
export interface FakeMail {
  provider: MailProvider;
  mailService: MailService;
  sent: MailMessage[];
  // Từ giờ mọi lần gửi ném lỗi (mô phỏng Resend down/sai key).
  failWith(error?: Error): void;
  reset(): void;
}

export function createFakeMail(): FakeMail {
  const sent: MailMessage[] = [];
  let failure: Error | null = null;

  const provider: MailProvider = {
    send: (message) => {
      if (failure) return Promise.reject(failure);
      sent.push(message);
      return Promise.resolve();
    },
  };

  return {
    provider,
    mailService: new MailService(provider),
    sent,
    failWith(error = new Error('mail provider down')) {
      failure = error;
    },
    reset() {
      sent.length = 0;
      failure = null;
    },
  };
}
