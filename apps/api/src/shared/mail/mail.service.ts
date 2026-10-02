import { Inject, Injectable } from '@nestjs/common';
import { MAIL_PROVIDER, type MailProvider } from './mail-provider.interface';
import type {
  OrderCancelledEmailData,
  OrderConfirmedEmailData,
  OrderPlacedEmailData,
  OrderShippedEmailData,
} from './templates/order-email.types';
import { orderCancelledTemplate } from './templates/order-cancelled.template';
import { orderConfirmedTemplate } from './templates/order-confirmed.template';
import { orderPlacedTemplate } from './templates/order-placed.template';
import { orderShippedTemplate } from './templates/order-shipped.template';
import { verifyEmailTemplate } from './templates/verify-email.template';

@Injectable()
export class MailService {
  constructor(@Inject(MAIL_PROVIDER) private readonly provider: MailProvider) {}

  async sendVerificationEmail(
    to: string,
    name: string,
    verifyUrl: string,
  ): Promise<void> {
    const { subject, html } = verifyEmailTemplate(name, verifyUrl);
    await this.provider.send({ to, subject, html });
  }

  // Email đơn hàng (Week8.md 2.8). Người gọi (OrderEmailService) chịu trách nhiệm bắt lỗi — các hàm
  // này ném lại lỗi của provider như sendVerificationEmail.
  async sendOrderPlaced(to: string, data: OrderPlacedEmailData): Promise<void> {
    await this.provider.send({ to, ...orderPlacedTemplate(data) });
  }

  async sendOrderConfirmed(
    to: string,
    data: OrderConfirmedEmailData,
  ): Promise<void> {
    await this.provider.send({ to, ...orderConfirmedTemplate(data) });
  }

  async sendOrderShipped(
    to: string,
    data: OrderShippedEmailData,
  ): Promise<void> {
    await this.provider.send({ to, ...orderShippedTemplate(data) });
  }

  async sendOrderCancelled(
    to: string,
    data: OrderCancelledEmailData,
  ): Promise<void> {
    await this.provider.send({ to, ...orderCancelledTemplate(data) });
  }
}
