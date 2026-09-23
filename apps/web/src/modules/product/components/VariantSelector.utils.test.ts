import { describe, expect, it } from 'vitest';

import {
  findMatchingVariant,
  isValueAvailable,
  type SelectorAttribute,
  type SelectorVariant,
} from './VariantSelector.utils';

function variant(
  id: string,
  attributeValues: { attributeName: string; value: string }[],
  overrides: Partial<SelectorVariant> = {},
): SelectorVariant {
  return {
    id,
    sku: id,
    price: '100000',
    stock: 10,
    isActive: true,
    images: [],
    weightGram: null,
    attributeValues,
    ...overrides,
  };
}

function attribute(id: string, name: string, values: string[]): SelectorAttribute {
  return {
    id,
    name,
    position: 0,
    values: values.map((value) => ({ id: `${id}-${value}`, value })),
  };
}

const colorSizeAttributes: SelectorAttribute[] = [
  attribute('attr-color', 'Màu sắc', ['Đỏ', 'Xanh']),
  attribute('attr-size', 'Size', ['M', 'L']),
];

const colorSizeVariants: SelectorVariant[] = [
  variant('v-do-m', [
    { attributeName: 'Màu sắc', value: 'Đỏ' },
    { attributeName: 'Size', value: 'M' },
  ]),
  variant(
    'v-do-l',
    [
      { attributeName: 'Màu sắc', value: 'Đỏ' },
      { attributeName: 'Size', value: 'L' },
    ],
    { stock: 0 },
  ),
  variant('v-xanh-m', [
    { attributeName: 'Màu sắc', value: 'Xanh' },
    { attributeName: 'Size', value: 'M' },
  ]),
  variant(
    'v-xanh-l',
    [
      { attributeName: 'Màu sắc', value: 'Xanh' },
      { attributeName: 'Size', value: 'L' },
    ],
    { isActive: false },
  ),
];

describe('findMatchingVariant', () => {
  it('trả về undefined khi chưa chọn đủ mọi attribute', () => {
    const result = findMatchingVariant(colorSizeVariants, colorSizeAttributes, {
      'Màu sắc': 'Đỏ',
    });

    expect(result).toBeUndefined();
  });

  it('trả về đúng variant khi đã chọn đủ combo khớp', () => {
    const result = findMatchingVariant(colorSizeVariants, colorSizeAttributes, {
      'Màu sắc': 'Đỏ',
      Size: 'M',
    });

    expect(result?.id).toBe('v-do-m');
  });

  it('vẫn trả về variant dù hết hàng (hết hàng khác với không tồn tại/bị gỡ)', () => {
    const result = findMatchingVariant(colorSizeVariants, colorSizeAttributes, {
      'Màu sắc': 'Đỏ',
      Size: 'L',
    });

    expect(result?.id).toBe('v-do-l');
  });

  it('KHÔNG trả về variant đã isActive=false dù chọn đúng combo', () => {
    const result = findMatchingVariant(colorSizeVariants, colorSizeAttributes, {
      'Màu sắc': 'Xanh',
      Size: 'L',
    });

    expect(result).toBeUndefined();
  });

  it('sản phẩm không có attribute (0 attribute) tự khớp variant mặc định duy nhất', () => {
    const singleVariant = [variant('v-default', [])];

    const result = findMatchingVariant(singleVariant, [], {});

    expect(result?.id).toBe('v-default');
  });
});

describe('isValueAvailable', () => {
  it('giá trị còn hàng (chưa chọn gì ở attribute khác) → available', () => {
    expect(isValueAvailable(colorSizeVariants, 'Màu sắc', 'Đỏ', {})).toBe(true);
  });

  it('giá trị chỉ dẫn tới variant hết hàng, không còn combo nào khác khớp → not available', () => {
    // Đã chọn Size=L, hỏi Màu sắc=Đỏ -> v-do-l nhưng stock=0
    expect(isValueAvailable(colorSizeVariants, 'Màu sắc', 'Đỏ', { Size: 'L' })).toBe(false);
  });

  it('giá trị chỉ dẫn tới variant isActive=false → not available (giống hết hàng)', () => {
    // Đã chọn Size=L, hỏi Màu sắc=Xanh -> v-xanh-l nhưng đã bị gỡ (isActive=false)
    expect(isValueAvailable(colorSizeVariants, 'Màu sắc', 'Xanh', { Size: 'L' })).toBe(false);
  });

  it('chưa chọn gì ở attribute khác, giá trị vẫn available nếu CÓ ÍT NHẤT 1 combo còn hàng', () => {
    // Size=L có v-do-l (hết hàng) và v-xanh-l (isActive=false) — cả 2 đều
    // không dùng được, nhưng câu hỏi là "Size=L available không" khi CHƯA
    // chọn màu — không còn combo nào còn hàng cho Size=L => false.
    expect(isValueAvailable(colorSizeVariants, 'Size', 'L', {})).toBe(false);
  });

  it('Size=M vẫn available khi chưa chọn màu (cả 2 combo Đỏ-M/Xanh-M đều còn hàng)', () => {
    expect(isValueAvailable(colorSizeVariants, 'Size', 'M', {})).toBe(true);
  });
});
