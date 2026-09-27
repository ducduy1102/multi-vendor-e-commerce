import { createAddressSchema, updateAddressSchema } from './address.dto';

const valid = {
  recipientName: 'Nguyễn Văn A',
  phone: '0912345678',
  line1: '12 Nguyễn Huệ',
  ward: 'Phường Bến Nghé',
  province: 'Hồ Chí Minh',
};

function messagesOf(
  schema: typeof createAddressSchema,
  payload: unknown,
): string[] {
  const result = schema.safeParse(payload);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.message);
}

describe('createAddressSchema', () => {
  it('payload hợp lệ', () => {
    expect(createAddressSchema.safeParse(valid).success).toBe(true);
  });

  describe('phone — chuẩn hoá về 0xxxxxxxxx', () => {
    it.each([
      ['0912345678', '0912345678'],
      ['+84912345678', '0912345678'],
      ['091 234 5678', '0912345678'],
      ['091.234.5678', '0912345678'],
      ['091-234-5678', '0912345678'],
      ['+84 (91) 234 5678', '0912345678'],
      ['  0339999999  ', '0339999999'],
    ])('%s → %s', (input, expected) => {
      const result = createAddressSchema.parse({ ...valid, phone: input });
      expect(result.phone).toBe(expected);
    });

    it.each([
      ['số bàn', '02838123456'],
      ['đầu số 1 không phải di động', '0112345678'],
      ['đầu số 2', '0212345678'],
      ['thiếu số', '091234567'],
      ['thừa số', '09123456789'],
      ['có chữ', '09123abc78'],
      ['chỉ +84 không có số', '+84'],
      ['84 không có dấu cộng', '84912345678'],
      ['rỗng', ''],
    ])('%s bị từ chối với key i18n', (_label, phone) => {
      expect(messagesOf(createAddressSchema, { ...valid, phone })).toContain(
        'checkout.validationPhoneInvalid',
      );
    });
  });

  describe('province — thuộc 34 tỉnh/thành, lưu tên chuẩn', () => {
    it.each([
      ['Hồ Chí Minh', 'Hồ Chí Minh'],
      ['ho chi minh', 'Hồ Chí Minh'],
      ['THÀNH PHỐ HỒ CHÍ MINH', 'Hồ Chí Minh'],
      ['Tỉnh Lâm Đồng', 'Lâm Đồng'],
      ['da nang', 'Đà Nẵng'],
    ])('%s → %s', (input, expected) => {
      expect(
        createAddressSchema.parse({ ...valid, province: input }).province,
      ).toBe(expected);
    });

    it.each(['Bình Dương', 'Hà Nam', 'Sài Gòn', 'Atlantis', ''])(
      '%s (không thuộc danh sách hiện hành) bị từ chối',
      (province) => {
        expect(
          messagesOf(createAddressSchema, { ...valid, province }),
        ).toContain('checkout.validationProvinceInvalid');
      },
    );
  });

  describe('recipientName / line1 / ward', () => {
    it('trim khoảng trắng hai đầu', () => {
      const result = createAddressSchema.parse({
        ...valid,
        recipientName: '  An  ',
        line1: ' 1 A ',
        ward: ' P1 ',
      });
      expect(result).toMatchObject({
        recipientName: 'An',
        line1: '1 A',
        ward: 'P1',
      });
    });

    it.each([
      ['recipientName', '', 'checkout.validationRecipientNameRequired'],
      ['recipientName', '   ', 'checkout.validationRecipientNameRequired'],
      [
        'recipientName',
        'a'.repeat(101),
        'checkout.validationRecipientNameTooLong',
      ],
      ['recipientName', 'An\nBình', 'checkout.validationRecipientNameRequired'],
      ['line1', '', 'checkout.validationLine1Required'],
      ['line1', 'a'.repeat(201), 'checkout.validationLine1TooLong'],
      ['ward', '', 'checkout.validationWardRequired'],
      ['ward', 'a'.repeat(101), 'checkout.validationWardTooLong'],
    ])('%s = %j bị từ chối với %s', (field, value, key) => {
      expect(
        messagesOf(createAddressSchema, { ...valid, [field]: value }),
      ).toContain(key);
    });

    it('đúng ngưỡng độ dài vẫn hợp lệ', () => {
      expect(
        createAddressSchema.safeParse({
          ...valid,
          recipientName: 'a'.repeat(100),
          line1: 'a'.repeat(200),
          ward: 'a'.repeat(100),
        }).success,
      ).toBe(true);
    });
  });

  it('không nhận userId/shopId/isDefault từ client (bị loại bỏ, không ghi được)', () => {
    const result = createAddressSchema.parse({
      ...valid,
      userId: 'someone-else',
      shopId: 'shop-1',
      isDefault: true,
    });
    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('shopId');
    expect(result).not.toHaveProperty('isDefault');
  });

  it.each(['recipientName', 'phone', 'line1', 'ward', 'province'])(
    'thiếu %s bị từ chối',
    (field) => {
      const { [field]: _omitted, ...rest } = valid as Record<string, string>;
      expect(createAddressSchema.safeParse(rest).success).toBe(false);
    },
  );
});

describe('updateAddressSchema', () => {
  it('sửa 1 phần: chỉ field gửi lên được chuẩn hoá, field không gửi không xuất hiện', () => {
    const result = updateAddressSchema.parse({ phone: '+84912345678' });
    expect(result).toEqual({ phone: '0912345678' });
  });

  it('body rỗng bị từ chối (không có gì để sửa)', () => {
    expect(messagesOf(updateAddressSchema as never, {})).toContain(
      'checkout.validationAddressUpdateEmpty',
    );
  });

  it('field gửi lên vẫn được kiểm hợp lệ', () => {
    expect(updateAddressSchema.safeParse({ phone: 'abc' }).success).toBe(false);
    expect(
      updateAddressSchema.safeParse({ province: 'Atlantis' }).success,
    ).toBe(false);
  });
});
