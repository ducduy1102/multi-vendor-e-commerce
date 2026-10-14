import { describe, expect, it } from 'vitest';

import { changePasswordFormSchema, profileFormSchema } from './account.schema';

describe('profileFormSchema', () => {
  it('hợp lệ: tên + ngôn ngữ vi/en; tên được cắt khoảng trắng', () => {
    const result = profileFormSchema.safeParse({ name: '  Nguyễn Văn A  ', locale: 'en' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ name: 'Nguyễn Văn A', locale: 'en' });
  });

  it('thiếu ngôn ngữ bị từ chối (form luôn có giá trị — khác đăng ký, ở đó locale tuỳ chọn)', () => {
    expect(profileFormSchema.safeParse({ name: 'Nguyễn Văn A' }).success).toBe(false);
  });

  it('ngôn ngữ ngoài vi/en bị từ chối bằng key i18n', () => {
    const result = profileFormSchema.safeParse({ name: 'A', locale: 'fr' });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0].message).toBe('auth.validationLocaleInvalid');
  });

  it.each([
    ['rỗng', '', 'auth.validationNameRequired'],
    ['chỉ khoảng trắng', '   ', 'auth.validationNameRequired'],
    ['101 ký tự', 'a'.repeat(101), 'auth.validationNameTooLong'],
    ['chứa ký tự < >', 'Tên <script>', 'auth.validationNameInvalid'],
    ['chứa ký tự điều khiển', 'Tên\u0000A', 'auth.validationNameInvalid'],
  ])('từ chối tên %s (cùng luật với đăng ký/BE)', (_label, name, message) => {
    const result = profileFormSchema.safeParse({ name, locale: 'vi' });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe(message);
  });
});

describe('changePasswordFormSchema', () => {
  const valid = {
    currentPassword: 'old-password-1',
    newPassword: 'new-password-2',
    confirmPassword: 'new-password-2',
  };

  it('hợp lệ khi mật khẩu mới khác cũ và nhập lại khớp', () => {
    expect(changePasswordFormSchema.safeParse(valid).success).toBe(true);
  });

  it('mật khẩu mới TRÙNG mật khẩu hiện tại bị chặn, lỗi gắn ở ô mật khẩu mới', () => {
    const result = changePasswordFormSchema.safeParse({
      currentPassword: 'same-password-1',
      newPassword: 'same-password-1',
      confirmPassword: 'same-password-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['newPassword'],
          message: 'auth.validationNewPasswordSame',
        }),
      );
    }
  });

  it('nhập lại không khớp bị chặn, lỗi gắn ở ô nhập lại', () => {
    const result = changePasswordFormSchema.safeParse({ ...valid, confirmPassword: 'khac-roi-3' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['confirmPassword'],
          message: 'auth.validationConfirmPasswordMismatch',
        }),
      );
    }
  });

  it('thiếu mật khẩu hiện tại bị chặn', () => {
    const result = changePasswordFormSchema.safeParse({ ...valid, currentPassword: '' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({
        path: ['currentPassword'],
        message: 'auth.validationPasswordRequired',
      });
    }
  });

  it('mật khẩu hiện tại KHÔNG bị giới hạn 72 ký tự (tài khoản cũ có thể dài hơn), chỉ chặn ở 1024', () => {
    const long = 'a'.repeat(200);
    expect(changePasswordFormSchema.safeParse({ ...valid, currentPassword: long }).success).toBe(
      true,
    );
    expect(
      changePasswordFormSchema.safeParse({ ...valid, currentPassword: 'a'.repeat(1025) }).success,
    ).toBe(false);
  });

  it.each([
    ['7 ký tự', '1234567', 'auth.validationPasswordMin'],
    ['73 ký tự', 'a'.repeat(73), 'auth.validationPasswordMax'],
    // 30 chữ "ệ" = 30 ký tự nhưng 90 byte UTF-8 — bcrypt chỉ đọc 72 byte đầu.
    ['30 chữ có dấu (90 byte)', 'ệ'.repeat(30), 'auth.validationPasswordMaxBytes'],
  ])('từ chối mật khẩu mới %s (cùng luật với đăng ký/đặt lại)', (_label, newPassword, message) => {
    const result = changePasswordFormSchema.safeParse({
      currentPassword: 'old-password-1',
      newPassword,
      confirmPassword: newPassword,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe(message);
  });
});
