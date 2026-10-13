import { UserLocale } from '@prisma/client';
import {
  authUserSchema,
  changePasswordSchema,
  EMAIL_MAX_LENGTH,
  forgotPasswordSchema,
  loginSchema,
  PASSWORD_INPUT_MAX_LENGTH,
  PASSWORD_RESET_TOKEN_MAX_LENGTH,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  USER_LOCALES,
  USER_NAME_MAX_LENGTH,
  userLocaleSchema,
} from '@ecommerce/types';

// Schema Zod dùng chung cho tài khoản (packages/types/src/auth.ts, Week9.md 5.2) — cùng precedent
// review-schemas.spec.ts: packages/types chưa có test runner riêng. Trọng tâm là phần BẢO MẬT của input:
// độ dài, ký tự điều khiển/giả mạo chiều chữ, mật khẩu theo BYTE (bcrypt), field không được phép gửi.

const messagesOf = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) =>
  result.success
    ? []
    : (result.error?.issues.map((issue) => issue.message) ?? []);

const NUL = String.fromCharCode(0x0000);
const RLO = String.fromCharCode(0x202e); // right-to-left override
const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe('USER_LOCALES', () => {
  it('khớp đúng enum Prisma UserLocale (không lệch khi thêm ngôn ngữ)', () => {
    expect([...USER_LOCALES].sort()).toEqual(Object.values(UserLocale).sort());
  });

  it.each(['vi', 'en'])('nhận %s', (locale) => {
    expect(userLocaleSchema.parse(locale)).toBe(locale);
  });

  it.each(['fr', 'VI', '', ' vi'])(
    'từ chối %p với key i18n của locale',
    (value) => {
      const result = userLocaleSchema.safeParse(value);
      expect(result.success).toBe(false);
      expect(messagesOf(result)).toEqual(['auth.validationLocaleInvalid']);
    },
  );

  it.each([null, undefined, 1])(
    'từ chối giá trị không phải chuỗi %p',
    (value) => {
      expect(userLocaleSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('registerSchema', () => {
  const valid = {
    email: 'user@example.com',
    password: 'password123',
    name: 'Nguyễn Văn A',
  };

  it('nhận dữ liệu hợp lệ, chuẩn hoá email (trim + chữ thường) và tên (trim)', () => {
    const result = registerSchema.parse({
      ...valid,
      email: '  User@Example.COM ',
      name: '  Nguyễn Văn A  ',
    });
    expect(result.email).toBe('user@example.com');
    expect(result.name).toBe('Nguyễn Văn A');
    expect(result.locale).toBeUndefined();
  });

  it('nhận locale tuỳ chọn, từ chối locale lạ', () => {
    expect(registerSchema.parse({ ...valid, locale: 'en' }).locale).toBe('en');
    expect(
      messagesOf(registerSchema.safeParse({ ...valid, locale: 'xx' })),
    ).toEqual(['auth.validationLocaleInvalid']);
  });

  describe('tên', () => {
    it(`nhận đúng ${USER_NAME_MAX_LENGTH} ký tự, từ chối ${USER_NAME_MAX_LENGTH + 1}`, () => {
      expect(
        registerSchema.safeParse({
          ...valid,
          name: 'a'.repeat(USER_NAME_MAX_LENGTH),
        }).success,
      ).toBe(true);
      expect(
        messagesOf(
          registerSchema.safeParse({
            ...valid,
            name: 'a'.repeat(USER_NAME_MAX_LENGTH + 1),
          }),
        ),
      ).toEqual(['auth.validationNameTooLong']);
    });

    it('từ chối tên rỗng / chỉ khoảng trắng', () => {
      expect(
        messagesOf(registerSchema.safeParse({ ...valid, name: '   ' })),
      ).toEqual(['auth.validationNameRequired']);
    });

    it.each([
      ['thẻ script', '<script>alert(1)</script>'],
      ['ký tự < đơn lẻ', 'a<b'],
      ['ký tự > đơn lẻ', 'a>b'],
      ['NUL (Postgres từ chối ghi, sẽ thành 500)', `a${NUL}b`],
      ['ký tự điều khiển xuống dòng', 'a\nb'],
      ['tab', 'a\tb'],
      ['bidi override (giả mạo thứ tự chữ)', `abc${RLO}def`],
      ['dấu phân dòng Unicode', `a${LINE_SEPARATOR}b`],
    ])('từ chối tên có %s', (_label, name) => {
      expect(
        messagesOf(registerSchema.safeParse({ ...valid, name })),
      ).toContain('auth.validationNameInvalid');
    });

    it.each(["O'Brien", 'Nguyễn Thị Hồng Ánh', 'Trần & Co.', '李小龍', 'Zoë'])(
      'nhận tên thật %s',
      (name) => {
        expect(registerSchema.safeParse({ ...valid, name }).success).toBe(true);
      },
    );
  });

  describe('mật khẩu — giới hạn của bcrypt tính theo BYTE', () => {
    it('nhận đúng 72 ký tự ASCII (72 byte)', () => {
      expect(
        registerSchema.safeParse({ ...valid, password: 'a'.repeat(72) })
          .success,
      ).toBe(true);
    });

    it('từ chối 73 ký tự ASCII bằng thông điệp cũ', () => {
      expect(
        messagesOf(
          registerSchema.safeParse({ ...valid, password: 'a'.repeat(73) }),
        ),
      ).toContain('auth.validationPasswordMax');
    });

    it('từ chối 7 ký tự', () => {
      expect(
        messagesOf(
          registerSchema.safeParse({ ...valid, password: 'a'.repeat(7) }),
        ),
      ).toEqual(['auth.validationPasswordMin']);
    });

    it('từ chối mật khẩu <72 ký tự nhưng >72 byte (dấu tiếng Việt 3 byte/ký tự)', () => {
      // 30 ký tự "ệ" = 90 byte: ít hơn 72 ký tự nhưng bcrypt sẽ bỏ im lặng phần đuôi.
      const password = 'ệ'.repeat(30);
      expect(password.length).toBeLessThan(72);
      expect(
        messagesOf(registerSchema.safeParse({ ...valid, password })),
      ).toEqual(['auth.validationPasswordMaxBytes']);
    });

    it('nhận mật khẩu có dấu nằm gọn trong 72 byte (24 ký tự "ệ" = 72 byte)', () => {
      expect(
        registerSchema.safeParse({ ...valid, password: 'ệ'.repeat(24) })
          .success,
      ).toBe(true);
    });

    it('tính emoji 4 byte (18 emoji = 72 byte nhận, 19 emoji = 76 byte từ chối)', () => {
      expect(
        registerSchema.safeParse({ ...valid, password: '😀'.repeat(18) })
          .success,
      ).toBe(true);
      expect(
        messagesOf(
          registerSchema.safeParse({ ...valid, password: '😀'.repeat(19) }),
        ),
      ).toEqual(['auth.validationPasswordMaxBytes']);
    });

    it('không trim mật khẩu (khoảng trắng đầu/cuối là một phần của mật khẩu)', () => {
      const result = registerSchema.parse({
        ...valid,
        password: '  spaced pw  ',
      });
      expect(result.password).toBe('  spaced pw  ');
    });
  });

  it('từ chối email dài quá 254 ký tự', () => {
    const email = `${'a'.repeat(EMAIL_MAX_LENGTH)}@example.com`;
    expect(registerSchema.safeParse({ ...valid, email }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('chuẩn hoá email, giữ nguyên mật khẩu', () => {
    const result = loginSchema.parse({
      email: ' A@B.co ',
      password: 'any thing',
    });
    expect(result).toEqual({ email: 'a@b.co', password: 'any thing' });
  });

  it('từ chối mật khẩu rỗng', () => {
    expect(
      messagesOf(loginSchema.safeParse({ email: 'a@b.co', password: '' })),
    ).toEqual(['auth.validationPasswordRequired']);
  });
});

describe('authUserSchema', () => {
  const user = {
    id: 'u1',
    email: 'a@b.co',
    name: 'A',
    role: 'USER',
    emailVerifiedAt: null,
    locale: 'vi',
    hasPassword: true,
  };

  it('nhận user đủ field', () => {
    expect(authUserSchema.parse(user)).toEqual(user);
  });

  it('bắt buộc có locale và hasPassword (FE dựa vào hai field này)', () => {
    expect(
      authUserSchema.safeParse({ ...user, locale: undefined }).success,
    ).toBe(false);
    expect(
      authUserSchema.safeParse({ ...user, hasPassword: undefined }).success,
    ).toBe(false);
  });

  it('bỏ field lạ (hash không lọt qua parse phía FE)', () => {
    const parsed = authUserSchema.parse({
      ...user,
      passwordHash: 'x',
      passwordResetTokenHash: 'y',
    });
    expect(parsed).not.toHaveProperty('passwordHash');
    expect(parsed).not.toHaveProperty('passwordResetTokenHash');
  });
});

describe('updateProfileSchema', () => {
  it('nhận chỉ name, chỉ locale, hoặc cả hai', () => {
    expect(updateProfileSchema.parse({ name: ' An ' })).toEqual({ name: 'An' });
    expect(updateProfileSchema.parse({ locale: 'en' })).toEqual({
      locale: 'en',
    });
    expect(updateProfileSchema.parse({ name: 'An', locale: 'vi' })).toEqual({
      name: 'An',
      locale: 'vi',
    });
  });

  it('từ chối body rỗng / không có field hợp lệ', () => {
    expect(messagesOf(updateProfileSchema.safeParse({}))).toEqual([
      'auth.validationProfileEmpty',
    ]);
    expect(
      messagesOf(updateProfileSchema.safeParse({ email: 'x@y.co' })),
    ).toEqual(['auth.validationProfileEmpty']);
  });

  it('bỏ email/role/accountStatus (mass assignment không tới được service)', () => {
    const parsed = updateProfileSchema.parse({
      name: 'An',
      email: 'evil@example.com',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      passwordHash: 'x',
      emailVerifiedAt: '2020-01-01',
    });
    expect(parsed).toEqual({ name: 'An' });
  });

  it('áp cùng luật tên với đăng ký', () => {
    expect(
      messagesOf(updateProfileSchema.safeParse({ name: '<b>x</b>' })),
    ).toEqual(['auth.validationNameInvalid']);
    expect(
      messagesOf(
        updateProfileSchema.safeParse({
          name: 'a'.repeat(USER_NAME_MAX_LENGTH + 1),
        }),
      ),
    ).toEqual(['auth.validationNameTooLong']);
  });
});

describe('changePasswordSchema', () => {
  it('nhận mật khẩu mới hợp lệ khác mật khẩu cũ', () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'old-password',
        newPassword: 'new-password-1',
      }).success,
    ).toBe(true);
  });

  it('từ chối mật khẩu mới trùng mật khẩu hiện tại, báo ở field newPassword', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'same-password',
      newPassword: 'same-password',
    });
    expect(messagesOf(result)).toEqual(['auth.validationNewPasswordSame']);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['newPassword']);
    }
  });

  it('thiếu mật khẩu hiện tại', () => {
    expect(
      messagesOf(
        changePasswordSchema.safeParse({
          currentPassword: '',
          newPassword: 'new-password-1',
        }),
      ),
    ).toEqual(['auth.validationPasswordRequired']);
  });

  it('mật khẩu mới theo cùng luật byte; mật khẩu cũ dài hơn 72 vẫn được nhận (tài khoản cũ)', () => {
    expect(
      messagesOf(
        changePasswordSchema.safeParse({
          currentPassword: 'old-password',
          newPassword: 'ệ'.repeat(30),
        }),
      ),
    ).toEqual(['auth.validationPasswordMaxBytes']);
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'o'.repeat(100),
        newPassword: 'new-password-1',
      }).success,
    ).toBe(true);
  });

  it(`từ chối mật khẩu hiện tại vô lý (> ${PASSWORD_INPUT_MAX_LENGTH} ký tự)`, () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'o'.repeat(PASSWORD_INPUT_MAX_LENGTH + 1),
        newPassword: 'new-password-1',
      }).success,
    ).toBe(false);
  });
});

describe('forgotPasswordSchema', () => {
  it('chuẩn hoá email', () => {
    expect(forgotPasswordSchema.parse({ email: ' X@Y.vn ' })).toEqual({
      email: 'x@y.vn',
    });
  });

  it.each(['', 'not-an-email', 'a@', '@b.co'])('từ chối %p', (email) => {
    expect(messagesOf(forgotPasswordSchema.safeParse({ email }))).toEqual([
      'auth.validationEmailInvalid',
    ]);
  });

  it('bỏ field lạ (không có chỗ nào chỉ định người nhận khác)', () => {
    expect(
      forgotPasswordSchema.parse({ email: 'a@b.co', to: 'evil@x.co' }),
    ).toEqual({ email: 'a@b.co' });
  });
});

describe('resetPasswordSchema', () => {
  const token = 'a'.repeat(64);

  it('nhận token + mật khẩu mới hợp lệ', () => {
    expect(
      resetPasswordSchema.safeParse({ token, newPassword: 'new-password-1' })
        .success,
    ).toBe(true);
  });

  it('token sai định dạng vẫn qua schema (ra RESET_TOKEN_INVALID ở service), nhưng bị chặn độ dài', () => {
    expect(
      resetPasswordSchema.safeParse({
        token: 'not-hex-at-all!',
        newPassword: 'new-password-1',
      }).success,
    ).toBe(true);
    expect(
      messagesOf(
        resetPasswordSchema.safeParse({
          token: 'a'.repeat(PASSWORD_RESET_TOKEN_MAX_LENGTH + 1),
          newPassword: 'new-password-1',
        }),
      ),
    ).toEqual(['auth.validationTokenInvalid']);
    expect(
      messagesOf(
        resetPasswordSchema.safeParse({
          token: '',
          newPassword: 'new-password-1',
        }),
      ),
    ).toEqual(['auth.validationTokenInvalid']);
  });

  it('mật khẩu mới theo cùng luật (độ dài + byte)', () => {
    expect(
      messagesOf(
        resetPasswordSchema.safeParse({ token, newPassword: 'short' }),
      ),
    ).toEqual(['auth.validationPasswordMin']);
    expect(
      messagesOf(
        resetPasswordSchema.safeParse({ token, newPassword: 'ệ'.repeat(30) }),
      ),
    ).toEqual(['auth.validationPasswordMaxBytes']);
  });
});
