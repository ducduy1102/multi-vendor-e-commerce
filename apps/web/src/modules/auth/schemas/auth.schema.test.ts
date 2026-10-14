import { describe, expect, it } from 'vitest';

import {
  forgotPasswordSchema,
  loginSchema,
  registerFormSchema,
  resetPasswordFormSchema,
} from './auth.schema';

describe('registerFormSchema', () => {
  const validInput = {
    email: 'user@example.com',
    password: 'password123',
    confirmPassword: 'password123',
    name: 'Nguyen Van A',
  };

  it('passes when confirmPassword matches password', () => {
    const result = registerFormSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('fails when confirmPassword does not match password', () => {
    const result = registerFormSchema.safeParse({
      ...validInput,
      confirmPassword: 'wrongpassword',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toEqual(['confirmPassword']);
      expect(issue.message).toBe('auth.validationConfirmPasswordMismatch');
    }
  });

  it('fails when confirmPassword is empty', () => {
    const result = registerFormSchema.safeParse({ ...validInput, confirmPassword: '' });
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('normalizes email casing/whitespace same as BE schema', () => {
    const result = loginSchema.safeParse({
      email: '  User@Example.com  ',
      password: 'anything',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('user@example.com');
    }
  });

  it('fails when password is empty', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com', password: '' });
    expect(result.success).toBe(false);
  });
});

describe('forgotPasswordSchema', () => {
  it('chuẩn hoá email giống BE (cắt khoảng trắng, chữ thường)', () => {
    const result = forgotPasswordSchema.safeParse({ email: '  User@Example.com ' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ email: 'user@example.com' });
  });

  it('từ chối email sai định dạng hoặc dài quá 254 ký tự', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'khong-phai-email' }).success).toBe(false);
    expect(forgotPasswordSchema.safeParse({ email: `${'a'.repeat(250)}@x.co` }).success).toBe(
      false,
    );
  });
});

describe('resetPasswordFormSchema', () => {
  const valid = { newPassword: 'password-moi-1', confirmPassword: 'password-moi-1' };

  it('hợp lệ khi mật khẩu mới khớp ô nhập lại', () => {
    expect(resetPasswordFormSchema.safeParse(valid).success).toBe(true);
  });

  it('không có field token — token do URL cấp chứ không phải người dùng nhập', () => {
    const result = resetPasswordFormSchema.safeParse({ ...valid, token: 'abc' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty('token');
  });

  it('gắn lỗi "không khớp" vào confirmPassword', () => {
    const result = resetPasswordFormSchema.safeParse({ ...valid, confirmPassword: 'khac-roi-1' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['confirmPassword']);
      expect(result.error.issues[0].message).toBe('auth.validationConfirmPasswordMismatch');
    }
  });

  it('ô nhập lại để trống bị chặn', () => {
    expect(resetPasswordFormSchema.safeParse({ ...valid, confirmPassword: '' }).success).toBe(
      false,
    );
  });

  it.each([
    ['7 ký tự', '1234567', 'auth.validationPasswordMin'],
    ['73 ký tự', 'a'.repeat(73), 'auth.validationPasswordMax'],
    // 30 chữ "ệ" = 30 ký tự nhưng 90 byte UTF-8 — bcrypt chỉ đọc 72 byte đầu (rules/backend.md mục 5).
    ['30 chữ có dấu (90 byte)', 'ệ'.repeat(30), 'auth.validationPasswordMaxBytes'],
  ])('từ chối mật khẩu mới %s', (_label, newPassword, message) => {
    const result = resetPasswordFormSchema.safeParse({ newPassword, confirmPassword: newPassword });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe(message);
  });

  it('chấp nhận biên: đúng 8 ký tự và đúng 72 byte', () => {
    const eight = '12345678';
    const seventyTwoBytes = 'ệ'.repeat(24);

    expect(
      resetPasswordFormSchema.safeParse({ newPassword: eight, confirmPassword: eight }).success,
    ).toBe(true);
    expect(
      resetPasswordFormSchema.safeParse({
        newPassword: seventyTwoBytes,
        confirmPassword: seventyTwoBytes,
      }).success,
    ).toBe(true);
  });
});
