import { Inject, Injectable } from '@nestjs/common';
import { MAIL_PROVIDER, type MailProvider } from './mail-provider.interface';
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
}
