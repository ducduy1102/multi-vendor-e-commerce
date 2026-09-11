import { Module } from '@nestjs/common';
import { MAIL_PROVIDER } from './mail-provider.interface';
import { MailService } from './mail.service';
import { ResendMailProvider } from './resend.provider';

@Module({
  providers: [
    MailService,
    { provide: MAIL_PROVIDER, useClass: ResendMailProvider },
  ],
  exports: [MailService],
})
export class MailModule {}
