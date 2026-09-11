import { Test } from '@nestjs/testing';
import {
  MAIL_PROVIDER,
  type MailMessage,
  type MailProvider,
} from './mail-provider.interface';
import { MailService } from './mail.service';

describe('MailService', () => {
  let service: MailService;
  let provider: { send: jest.Mock<Promise<void>, [MailMessage]> };

  beforeEach(async () => {
    provider = {
      send: jest
        .fn<Promise<void>, [MailMessage]>()
        .mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: MAIL_PROVIDER, useValue: provider as MailProvider },
      ],
    }).compile();

    service = moduleRef.get(MailService);
  });

  describe('sendVerificationEmail', () => {
    it('gọi provider.send với subject/html chứa link verify, không lộ chi tiết provider ra ngoài', async () => {
      await service.sendVerificationEmail(
        'user@example.com',
        'Nguyen Van A',
        'http://localhost:3000/verify-email?token=abc123',
      );

      expect(provider.send).toHaveBeenCalledTimes(1);
      const message = provider.send.mock.calls[0][0];
      expect(message.to).toBe('user@example.com');
      expect(message.subject).toEqual(expect.any(String));
      expect(message.html).toContain(
        'http://localhost:3000/verify-email?token=abc123',
      );
      expect(message.html).toContain('Nguyen Van A');
    });
  });
});
