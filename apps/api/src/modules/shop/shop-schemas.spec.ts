import {
  createShopSchema,
  publicShopSchema,
  SHOP_DESCRIPTION_MAX_LENGTH,
  SHOP_NAME_MAX_LENGTH,
  SHOP_RESERVED_SLUGS,
  SHOP_SLUG_MAX_LENGTH,
  SHOP_URL_MAX_LENGTH,
  shopSlugSchema,
  updateShopSchema,
} from '@ecommerce/types';

// Schema Zod dùng chung cho shop (packages/types/src/shop.ts). Phần được siết ở Week9.md 5.2: độ dài, ký tự
// lạ trong tên/mô tả, và URL logo/banner chỉ nhận https (chặn javascript:/data:). Cùng precedent
// review-schemas.spec.ts: packages/types chưa có test runner riêng.

const messagesOf = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) =>
  result.success
    ? []
    : (result.error?.issues.map((issue) => issue.message) ?? []);

const NUL = String.fromCharCode(0x0000);
const RLO = String.fromCharCode(0x202e);

describe('createShopSchema — tên', () => {
  it('nhận tên hợp lệ có dấu và trim khoảng trắng', () => {
    expect(createShopSchema.parse({ name: '  Cửa hàng Hoa Hồng  ' }).name).toBe(
      'Cửa hàng Hoa Hồng',
    );
  });

  it(`nhận đúng ${SHOP_NAME_MAX_LENGTH} ký tự, từ chối ${SHOP_NAME_MAX_LENGTH + 1}`, () => {
    expect(
      createShopSchema.safeParse({ name: 'a'.repeat(SHOP_NAME_MAX_LENGTH) })
        .success,
    ).toBe(true);
    expect(
      messagesOf(
        createShopSchema.safeParse({
          name: 'a'.repeat(SHOP_NAME_MAX_LENGTH + 1),
        }),
      ),
    ).toEqual(['shop.validationNameTooLong']);
  });

  it('từ chối tên rỗng', () => {
    expect(messagesOf(createShopSchema.safeParse({ name: '  ' }))).toEqual([
      'shop.validationNameRequired',
    ]);
  });

  it.each([
    ['thẻ HTML', '<img src=x onerror=alert(1)>'],
    ['NUL', `Shop${NUL}`],
    ['xuống dòng', 'Shop\nA'],
    ['bidi override', `Shop${RLO}A`],
  ])('từ chối tên có %s', (_label, name) => {
    expect(messagesOf(createShopSchema.safeParse({ name }))).toContain(
      'shop.validationNameInvalid',
    );
  });
});

describe('createShopSchema — mô tả', () => {
  it('bỏ trống hoặc "" ⇒ undefined (không để field rác)', () => {
    expect(createShopSchema.parse({ name: 'A' }).description).toBeUndefined();
    expect(
      createShopSchema.parse({ name: 'A', description: '   ' }).description,
    ).toBeUndefined();
  });

  it('cho phép xuống dòng và tab, giữ nguyên ký tự < > thông thường', () => {
    const description = 'Dòng 1\nDòng 2\tcột\nHàng nhẹ < 5kg';
    expect(createShopSchema.parse({ name: 'A', description }).description).toBe(
      description,
    );
  });

  it(`nhận đúng ${SHOP_DESCRIPTION_MAX_LENGTH} ký tự, từ chối ${SHOP_DESCRIPTION_MAX_LENGTH + 1}`, () => {
    expect(
      createShopSchema.safeParse({
        name: 'A',
        description: 'a'.repeat(SHOP_DESCRIPTION_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      messagesOf(
        createShopSchema.safeParse({
          name: 'A',
          description: 'a'.repeat(SHOP_DESCRIPTION_MAX_LENGTH + 1),
        }),
      ),
    ).toEqual(['shop.validationDescriptionTooLong']);
  });

  it('từ chối NUL và bidi override trong mô tả', () => {
    expect(
      messagesOf(
        createShopSchema.safeParse({ name: 'A', description: `x${NUL}y` }),
      ),
    ).toEqual(['shop.validationDescriptionInvalid']);
    expect(
      messagesOf(
        createShopSchema.safeParse({ name: 'A', description: `x${RLO}y` }),
      ),
    ).toEqual(['shop.validationDescriptionInvalid']);
  });
});

describe('createShopSchema — logo/banner chỉ nhận https', () => {
  it.each(['logoUrl', 'bannerUrl'] as const)(
    '%s: nhận URL https của Cloudinary',
    (field) => {
      const url = 'https://res.cloudinary.com/demo/image/upload/v1/shop.png';
      expect(createShopSchema.parse({ name: 'A', [field]: url })[field]).toBe(
        url,
      );
    },
  );

  it.each(['logoUrl', 'bannerUrl'] as const)(
    '%s: "" hoặc bỏ trống ⇒ undefined',
    (field) => {
      expect(createShopSchema.parse({ name: 'A', [field]: '' })[field]).toBe(
        undefined,
      );
      expect(createShopSchema.parse({ name: 'A' })[field]).toBeUndefined();
    },
  );

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['file:', 'file:///etc/passwd'],
    ['http thường (nội dung hỗn hợp)', 'http://example.com/logo.png'],
    ['protocol-relative', '//evil.com/logo.png'],
    ['không có scheme', 'example.com/logo.png'],
    ['https rỗng', 'https://'],
  ])('logoUrl: từ chối %s', (_label, logoUrl) => {
    expect(
      messagesOf(createShopSchema.safeParse({ name: 'A', logoUrl })),
    ).toEqual(['shop.validationLogoUrlInvalid']);
  });

  it('bannerUrl: dùng key riêng của banner', () => {
    expect(
      messagesOf(
        createShopSchema.safeParse({
          name: 'A',
          bannerUrl: 'javascript:alert(1)',
        }),
      ),
    ).toEqual(['shop.validationBannerUrlInvalid']);
  });

  it(`từ chối URL dài hơn ${SHOP_URL_MAX_LENGTH} ký tự`, () => {
    const logoUrl = `https://example.com/${'a'.repeat(SHOP_URL_MAX_LENGTH)}`;
    expect(createShopSchema.safeParse({ name: 'A', logoUrl }).success).toBe(
      false,
    );
  });
});

describe('createShopSchema — slug', () => {
  it('nhận slug đúng định dạng', () => {
    expect(createShopSchema.parse({ name: 'A', slug: 'hoa-hong-1' }).slug).toBe(
      'hoa-hong-1',
    );
  });

  it.each(['Hoa-Hong', 'hoa hong', 'hoa--hong', '-hoa', 'hoa-', '../etc'])(
    'từ chối slug %p',
    (slug) => {
      expect(
        messagesOf(createShopSchema.safeParse({ name: 'A', slug })),
      ).toEqual(['shop.validationSlugFormat']);
    },
  );

  it(`từ chối slug dài hơn ${SHOP_SLUG_MAX_LENGTH} ký tự`, () => {
    expect(
      messagesOf(
        createShopSchema.safeParse({
          name: 'A',
          slug: 'a'.repeat(SHOP_SLUG_MAX_LENGTH + 1),
        }),
      ),
    ).toEqual(['shop.validationSlugTooLong']);
  });
});

describe('slug dành riêng và shopSlugSchema', () => {
  it('"me" là slug dành riêng (trùng GET /shops/me)', () => {
    expect(SHOP_RESERVED_SLUGS).toContain('me');
  });

  it('tự nhập slug dành riêng bị từ chối bằng key riêng', () => {
    expect(
      messagesOf(createShopSchema.safeParse({ name: 'A', slug: 'me' })),
    ).toEqual(['shop.validationSlugReserved']);
  });

  it('slug gần giống (me-2, mee) vẫn hợp lệ', () => {
    expect(
      createShopSchema.safeParse({ name: 'A', slug: 'me-2' }).success,
    ).toBe(true);
    expect(createShopSchema.safeParse({ name: 'A', slug: 'mee' }).success).toBe(
      true,
    );
  });

  it('shopSlugSchema (tham số đường dẫn công khai): nhận slug đúng, từ chối phần còn lại', () => {
    expect(shopSlugSchema.parse('shop-thoi-trang-1')).toBe('shop-thoi-trang-1');
    for (const bad of ['', 'Shop', 'a b', '../x', 'a--b']) {
      expect(shopSlugSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('updateShopSchema', () => {
  it('mọi field tuỳ chọn, {} hợp lệ, slug không sửa được (bị bỏ)', () => {
    expect(updateShopSchema.parse({})).toEqual({});
    expect(updateShopSchema.parse({ slug: 'doi-slug', name: 'B' })).toEqual({
      name: 'B',
    });
  });

  it('áp cùng luật với tạo shop', () => {
    expect(messagesOf(updateShopSchema.safeParse({ name: '<b>' }))).toEqual([
      'shop.validationNameInvalid',
    ]);
    expect(
      messagesOf(updateShopSchema.safeParse({ logoUrl: 'javascript:1' })),
    ).toEqual(['shop.validationLogoUrlInvalid']);
  });
});

describe('publicShopSchema', () => {
  const shop = {
    id: 's1',
    name: 'Shop',
    slug: 'shop',
    logoUrl: null,
    bannerUrl: null,
    description: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    productCount: 3,
    avgRating: 4.5,
    reviewCount: 10,
  };

  it('nhận shop đủ field, kể cả chưa có logo/banner/mô tả/đánh giá', () => {
    expect(publicShopSchema.parse(shop)).toEqual(shop);
    expect(
      publicShopSchema.safeParse({
        ...shop,
        productCount: 0,
        avgRating: 0,
        reviewCount: 0,
      }).success,
    ).toBe(true);
  });

  it('KHÔNG mang thông tin chủ shop/trạng thái dù response có thừa field', () => {
    const parsed = publicShopSchema.parse({
      ...shop,
      ownerId: 'u1',
      status: 'APPROVED',
      statusReason: 'x',
      email: 'owner@example.com',
    });
    expect(parsed).not.toHaveProperty('ownerId');
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('statusReason');
    expect(parsed).not.toHaveProperty('email');
  });

  it.each([
    ['điểm âm', { avgRating: -1 }],
    ['điểm > 5', { avgRating: 5.1 }],
    ['số đánh giá âm', { reviewCount: -1 }],
    ['số đánh giá lẻ', { reviewCount: 1.5 }],
    ['số sản phẩm âm', { productCount: -1 }],
  ])('từ chối %s', (_label, patch) => {
    expect(publicShopSchema.safeParse({ ...shop, ...patch }).success).toBe(
      false,
    );
  });
});
