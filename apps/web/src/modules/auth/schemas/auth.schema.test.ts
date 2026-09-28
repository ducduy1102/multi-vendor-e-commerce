import { describe, expect, it } from 'vitest';

import { loginSchema, registerFormSchema } from './auth.schema';

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
