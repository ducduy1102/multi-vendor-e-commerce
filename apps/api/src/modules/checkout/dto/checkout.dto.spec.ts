import {
  idempotencyKeySchema,
  placeOrderSchema,
  previewCheckoutSchema,
} from './checkout.dto';

const valid = {
  addressId: 'address-1',
  paymentMethod: 'VNPAY',
  voucherCode: 'GIAM50K',
  expectedTotal: 250000,
};

function messagesOf(
  schema: typeof placeOrderSchema,
  payload: unknown,
): string[] {
  const result = schema.safeParse(payload);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.message);
}

describe('placeOrderSchema', () => {
  it('payload hợp lệ', () => {
    expect(placeOrderSchema.safeParse(valid).success).toBe(true);
  });

  it('voucherCode tuỳ chọn, chuỗi rỗng/khoảng trắng hợp lệ (ô nhập bỏ trống gửi "")', () => {
    const { voucherCode: _omitted, ...withoutVoucher } = valid;
    expect(placeOrderSchema.safeParse(withoutVoucher).success).toBe(true);
    expect(
      placeOrderSchema.safeParse({ ...valid, voucherCode: '   ' }).success,
    ).toBe(true);
  });

  describe('expectedTotal BẮT BUỘC (1.11)', () => {
    it('thiếu ⇒ 400 với key i18n', () => {
      const { expectedTotal: _omitted, ...rest } = valid;
      expect(messagesOf(placeOrderSchema, rest)).toContain(
        'checkout.validationExpectedTotalInvalid',
      );
    });

    it.each([
      ['âm', -1],
      ['không nguyên', 100.5],
      ['chuỗi', '250000'],
      ['null', null],
      ['NaN', NaN],
    ])('%s bị từ chối', (_label, expectedTotal) => {
      expect(
        placeOrderSchema.safeParse({ ...valid, expectedTotal }).success,
      ).toBe(false);
    });

    it('0 hợp lệ (đơn được giảm hết tiền hàng và miễn ship)', () => {
      expect(
        placeOrderSchema.safeParse({ ...valid, expectedTotal: 0 }).success,
      ).toBe(true);
    });
  });

  it.each([
    [
      'thiếu addressId',
      { ...valid, addressId: undefined },
      'checkout.validationAddressRequired',
    ],
    [
      'addressId rỗng',
      { ...valid, addressId: '' },
      'checkout.validationAddressRequired',
    ],
  ])('%s bị từ chối với key i18n', (_label, payload, key) => {
    expect(messagesOf(placeOrderSchema, payload)).toContain(key);
  });

  it.each(['PAYPAL', 'vnpay', '', undefined])(
    'paymentMethod %p bị từ chối',
    (paymentMethod) => {
      expect(
        placeOrderSchema.safeParse({ ...valid, paymentMethod }).success,
      ).toBe(false);
    },
  );

  it('chấp nhận COD ở mức validate (khả dụng thật do PaymentGatewayService quyết định, Week8.md 2.7)', () => {
    expect(
      placeOrderSchema.safeParse({ ...valid, paymentMethod: 'COD' }).success,
    ).toBe(true);
  });

  it('chấp nhận MOMO', () => {
    expect(
      placeOrderSchema.safeParse({ ...valid, paymentMethod: 'MOMO' }).success,
    ).toBe(true);
  });

  it('không nhận userId từ client (bị loại bỏ)', () => {
    expect(
      placeOrderSchema.parse({ ...valid, userId: 'someone-else' }),
    ).not.toHaveProperty('userId');
  });
});

describe('previewCheckoutSchema', () => {
  it('body rỗng hợp lệ (chưa chọn địa chỉ, chưa có mã)', () => {
    expect(previewCheckoutSchema.safeParse({}).success).toBe(true);
  });

  it('có addressId + voucherCode', () => {
    expect(
      previewCheckoutSchema.safeParse({
        addressId: 'a1',
        voucherCode: 'SALE10',
      }).success,
    ).toBe(true);
  });

  it('addressId rỗng bị từ chối', () => {
    expect(previewCheckoutSchema.safeParse({ addressId: '' }).success).toBe(
      false,
    );
  });
});

describe('idempotencyKeySchema', () => {
  it('UUID hợp lệ', () => {
    expect(
      idempotencyKeySchema.safeParse('3f6c1e4a-9b1d-4c1e-8a55-0d2c4f5a6b7c')
        .success,
    ).toBe(true);
  });

  it.each([
    '',
    'abc',
    '12345',
    '3f6c1e4a-9b1d-4c1e-8a55',
    'not-a-uuid-at-all-not-a-uuid-at-all!',
  ])('%j bị từ chối với key i18n', (value) => {
    const result = idempotencyKeySchema.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'checkout.validationIdempotencyKeyInvalid',
      );
    }
  });
});
