import type { Profile, VerifyCallback } from 'passport-google-oauth20';
import { GoogleStrategy } from './google.strategy';

describe('GoogleStrategy', () => {
  let strategy: GoogleStrategy;

  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  beforeEach(() => {
    strategy = new GoogleStrategy();
  });

  it('map profile Google sang GoogleProfile (googleId/email/name)', () => {
    const done: VerifyCallback = jest.fn();
    const profile = {
      id: 'google-sub-123',
      displayName: 'Nguyen Van A',
      emails: [{ value: 'user@example.com', verified: true }],
    } as unknown as Profile;

    strategy.validate('access-token', 'refresh-token', profile, done);

    expect(done).toHaveBeenCalledWith(null, {
      googleId: 'google-sub-123',
      email: 'user@example.com',
      name: 'Nguyen Van A',
    });
  });

  it('báo lỗi qua done() nếu tài khoản Google không có email công khai', () => {
    const done: VerifyCallback = jest.fn();
    const profile = {
      id: 'google-sub-123',
      displayName: 'Nguyen Van A',
      emails: [],
    } as unknown as Profile;

    strategy.validate('access-token', 'refresh-token', profile, done);

    expect(done).toHaveBeenCalledWith(expect.any(Error), false);
  });
});
