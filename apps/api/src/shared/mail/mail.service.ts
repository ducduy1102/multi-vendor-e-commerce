import { Inject, Injectable } from '@nestjs/common';
import { MAIL_PROVIDER, type MailProvider } from './mail-provider.interface';
import type { MailLocale } from './mail-locale';
import type {
  AccountStatusEmailData,
  PasswordChangedEmailData,
  PasswordResetEmailData,
  ShopStatusEmailData,
} from './templates/account-email.types';
import type {
  OrderCancelledEmailData,
  OrderCompletedEmailData,
  OrderConfirmedEmailData,
  OrderPlacedEmailData,
  OrderRefundedEmailData,
  OrderShippedEmailData,
  RefundRequestRejectedEmailData,
} from './templates/order-email.types';
import { accountStatusTemplate } from './templates/account-status.template';
import { orderCancelledTemplate } from './templates/order-cancelled.template';
import { orderCompletedTemplate } from './templates/order-completed.template';
import { orderConfirmedTemplate } from './templates/order-confirmed.template';
import { orderPlacedTemplate } from './templates/order-placed.template';
import { orderRefundedTemplate } from './templates/order-refunded.template';
import { orderShippedTemplate } from './templates/order-shipped.template';
import { passwordChangedTemplate } from './templates/password-changed.template';
import { passwordResetTemplate } from './templates/password-reset.template';
import { refundRequestRejectedTemplate } from './templates/refund-request-rejected.template';
import { shopStatusTemplate } from './templates/shop-status.template';
import { verifyEmailTemplate } from './templates/verify-email.template';

// Tiêu đề thư là văn bản thuần nhưng có chứa dữ liệu người nhập (tên shop...). Xuống dòng/ký tự điều khiển
// trong một header là cách kinh điển để chèn thêm header (header injection) — gộp về một dòng ở MỘT chỗ
// duy nhất cho mọi template, thay vì tin từng template tự nhớ.
function toSingleLine(subject: string): string {
  // eslint-disable-next-line no-control-regex
  return subject.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();
}

// Mọi hàm `send*` ném lại lỗi của provider — người gọi chịu trách nhiệm bắt (gửi mail là việc SAU khi DB đã
// commit, lỗi mail không được làm hỏng request; rules/backend.md mục 4). Mọi hàm đều nhận `locale` của người
// nhận (User.locale, Week9.md 1.12): trong `data` với email có nhiều trường, hoặc tham số tường minh.
@Injectable()
export class MailService {
  constructor(@Inject(MAIL_PROVIDER) private readonly provider: MailProvider) {}

  private async deliver(
    to: string,
    message: { subject: string; html: string },
  ): Promise<void> {
    await this.provider.send({
      to,
      subject: toSingleLine(message.subject),
      html: message.html,
    });
  }

  async sendVerificationEmail(
    to: string,
    name: string,
    verifyUrl: string,
    locale: MailLocale,
  ): Promise<void> {
    await this.deliver(to, verifyEmailTemplate(name, verifyUrl, locale));
  }

  // Tài khoản (Week9.md 1.11).
  async sendPasswordReset(
    to: string,
    data: PasswordResetEmailData,
  ): Promise<void> {
    await this.deliver(to, passwordResetTemplate(data));
  }

  async sendPasswordChanged(
    to: string,
    data: PasswordChangedEmailData,
  ): Promise<void> {
    await this.deliver(to, passwordChangedTemplate(data));
  }

  // Trạng thái tài khoản do Admin đổi (Week11.md 3.3). Người gọi chịu trách nhiệm bắt lỗi.
  async sendAccountStatusChanged(
    to: string,
    data: AccountStatusEmailData,
  ): Promise<void> {
    await this.deliver(to, accountStatusTemplate(data));
  }

  // Trạng thái shop (Week9.md 1.13).
  async sendShopStatusChanged(
    to: string,
    data: ShopStatusEmailData,
  ): Promise<void> {
    await this.deliver(to, shopStatusTemplate(data));
  }

  // Email đơn hàng (Week8.md 2.8). Người gọi (OrderEmailService) chịu trách nhiệm bắt lỗi.
  async sendOrderPlaced(to: string, data: OrderPlacedEmailData): Promise<void> {
    await this.deliver(to, orderPlacedTemplate(data));
  }

  async sendOrderConfirmed(
    to: string,
    data: OrderConfirmedEmailData,
  ): Promise<void> {
    await this.deliver(to, orderConfirmedTemplate(data));
  }

  async sendOrderShipped(
    to: string,
    data: OrderShippedEmailData,
  ): Promise<void> {
    await this.deliver(to, orderShippedTemplate(data));
  }

  async sendOrderCancelled(
    to: string,
    data: OrderCancelledEmailData,
  ): Promise<void> {
    await this.deliver(to, orderCancelledTemplate(data));
  }

  // Đơn đã hoàn tất — người mua tự bấm hoặc hệ thống tự hoàn tất (Week10.md 7.5).
  async sendOrderCompleted(
    to: string,
    data: OrderCompletedEmailData,
  ): Promise<void> {
    await this.deliver(to, orderCompletedTemplate(data));
  }

  // Yêu cầu hủy / trả hàng bị shop hoặc Admin từ chối (Week10.md 7.5).
  async sendRefundRequestRejected(
    to: string,
    data: RefundRequestRejectedEmailData,
  ): Promise<void> {
    await this.deliver(to, refundRequestRejectedTemplate(data));
  }

  // Duyệt trả hàng/hoàn tiền sau giao (Week9.md 1.3).
  async sendOrderRefunded(
    to: string,
    data: OrderRefundedEmailData,
  ): Promise<void> {
    await this.deliver(to, orderRefundedTemplate(data));
  }
}
