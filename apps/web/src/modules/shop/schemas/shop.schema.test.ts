import { describe, expect, it } from 'vitest';

import { createShopSchema, updateShopSchema } from './shop.schema';

describe('createShopSchema', () => {
  it('passes with just a name', () => {
    const result = createShopSchema.safeParse({ name: 'Shop ABC' });
    expect(result.success).toBe(true);
  });

  it('fails when name is empty', () => {
    const result = createShopSchema.safeParse({ name: '' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('shop.validationNameRequired');
    }
  });

  // Regression: React Hook Form gửi "" cho input bỏ trống (không phải
  // undefined) — field optional phải coi "" là chưa nhập, không lộ field rác
  // lên payload gửi BE (xem Week3.md Bước 3.6).
  it('treats blank optional fields (description/logoUrl/bannerUrl) as absent', () => {
    const result = createShopSchema.safeParse({
      name: 'Shop ABC',
      description: '',
      logoUrl: '',
      bannerUrl: '',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: 'Shop ABC' });
    }
  });

  it('fails when logoUrl is a non-empty invalid URL', () => {
    const result = createShopSchema.safeParse({ name: 'Shop ABC', logoUrl: 'not-a-url' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('shop.validationLogoUrlInvalid');
    }
  });

  it('accepts a valid logoUrl/bannerUrl', () => {
    const result = createShopSchema.safeParse({
      name: 'Shop ABC',
      logoUrl: 'https://example.com/logo.png',
      bannerUrl: 'https://example.com/banner.png',
    });

    expect(result.success).toBe(true);
  });

  it('accepts a kebab-case slug', () => {
    const result = createShopSchema.safeParse({ name: 'Shop ABC', slug: 'shop-abc-2' });
    expect(result.success).toBe(true);
  });

  it('rejects a slug with uppercase/space/diacritics', () => {
    const result = createShopSchema.safeParse({ name: 'Shop ABC', slug: 'Shop ABC' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('shop.validationSlugFormat');
    }
  });
});

describe('updateShopSchema', () => {
  it('passes with an empty object (partial update, no field changed)', () => {
    const result = updateShopSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  // BE khoá slug/status qua endpoint update (xem Week3.md Bước 2.5) — schema
  // không khai 2 field này nên z.object() (mode "strip" mặc định) tự loại bỏ
  // thay vì báo lỗi, FE gửi nhầm cũng không lộ field lên payload thật.
  it('strips slug/status if present instead of rejecting the whole payload', () => {
    const result = updateShopSchema.safeParse({
      name: 'Tên mới',
      slug: 'some-slug',
      status: 'APPROVED',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: 'Tên mới' });
    }
  });
});
