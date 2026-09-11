export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
}

// Auth/Order/Shop module chỉ biết tới MailService, không biết provider nào
// đang chạy phía sau (Resend/SendGrid...) — đổi provider chỉ đổi binding của
// MAIL_PROVIDER trong MailModule.
export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}
