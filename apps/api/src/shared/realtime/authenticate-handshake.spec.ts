import { Role } from '@prisma/client';
import { authenticateHandshake } from './authenticate-handshake';
import type { VerifiedSocketToken } from './socket-authenticator';

const USER: VerifiedSocketToken = {
  userId: 'user-1',
  role: Role.USER,
  exp: 1_900_000_000,
};

function fakeAuthenticator(
  overrides: { verifyToken?: jest.Mock; isUserActive?: jest.Mock } = {},
) {
  return {
    verifyToken: overrides.verifyToken ?? jest.fn().mockResolvedValue(USER),
    isUserActive: overrides.isUserActive ?? jest.fn().mockResolvedValue(true),
  };
}

describe('authenticateHandshake', () => {
  it('cookie hợp lệ, token đúng, tài khoản ACTIVE ⇒ trả người dùng', async () => {
    const authenticator = fakeAuthenticator();

    const result = await authenticateHandshake(
      { cookie: 'NEXT_LOCALE=vi; access_token=good.jwt.token' },
      authenticator,
    );

    expect(result).toEqual({ ok: true, user: USER });
    expect(authenticator.verifyToken).toHaveBeenCalledWith('good.jwt.token');
    expect(authenticator.isUserActive).toHaveBeenCalledWith('user-1');
  });

  describe('thiếu token ⇒ MISSING_TOKEN, không gọi cổng xác thực', () => {
    it.each([
      ['không có header cookie', undefined],
      ['header rỗng', ''],
      ['chỉ có cookie khác', 'NEXT_LOCALE=vi; refresh_token=abc'],
      ['access_token để trống', 'access_token='],
    ])('%s', async (_name, cookie) => {
      const authenticator = fakeAuthenticator();

      const result = await authenticateHandshake({ cookie }, authenticator);

      expect(result).toEqual({ ok: false, reason: 'MISSING_TOKEN' });
      expect(authenticator.verifyToken).not.toHaveBeenCalled();
    });
  });

  it('chỉ đọc cookie access_token: refresh_token không được dùng thay', async () => {
    const authenticator = fakeAuthenticator();

    const result = await authenticateHandshake(
      { cookie: 'refresh_token=some.refresh.token' },
      authenticator,
    );

    expect(result).toEqual({ ok: false, reason: 'MISSING_TOKEN' });
    expect(authenticator.verifyToken).not.toHaveBeenCalled();
  });

  it('token sai/hết hạn ⇒ INVALID_TOKEN và không tốn một truy vấn DB kiểm tài khoản', async () => {
    const authenticator = fakeAuthenticator({
      verifyToken: jest.fn().mockResolvedValue(null),
    });

    const result = await authenticateHandshake(
      { cookie: 'access_token=bad' },
      authenticator,
    );

    expect(result).toEqual({ ok: false, reason: 'INVALID_TOKEN' });
    expect(authenticator.isUserActive).not.toHaveBeenCalled();
  });

  it('token còn hạn nhưng tài khoản bị khoá ⇒ ACCOUNT_NOT_ACTIVE', async () => {
    const authenticator = fakeAuthenticator({
      isUserActive: jest.fn().mockResolvedValue(false),
    });

    const result = await authenticateHandshake(
      { cookie: 'access_token=good' },
      authenticator,
    );

    expect(result).toEqual({ ok: false, reason: 'ACCOUNT_NOT_ACTIVE' });
  });

  describe('lỗi hạ tầng của cổng xác thực được ném tiếp (không biến thành "token sai")', () => {
    it('verifyToken ném', async () => {
      const authenticator = fakeAuthenticator({
        verifyToken: jest.fn().mockRejectedValue(new Error('no secret')),
      });

      await expect(
        authenticateHandshake({ cookie: 'access_token=x' }, authenticator),
      ).rejects.toThrow('no secret');
    });

    it('isUserActive ném (DB sập)', async () => {
      const authenticator = fakeAuthenticator({
        isUserActive: jest.fn().mockRejectedValue(new Error('db down')),
      });

      await expect(
        authenticateHandshake({ cookie: 'access_token=x' }, authenticator),
      ).rejects.toThrow('db down');
    });
  });
});
