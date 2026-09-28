import { validationMessage } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import { createProductSchema, updateProductSchema } from './product.schema';

// createProductSchema/updateProductSchema chỉ re-export nguyên vẹn từ
// @ecommerce/types (không có logic riêng ở FE) — nhưng logic nghiệp vụ cốt
// lõi của chính schema đó (validateAttributesAndVariants, superRefine) chưa
// từng có test tự động ở bất kỳ đâu trong repo trước đây (Week4.md Bước 2.3
// chỉ verify bằng script Node tạm, đã xoá sau khi verify) — test ở đây lấp
// đúng khoảng trống đó, đúng rules/general.md mục 5 ("mỗi module bắt buộc có
// test cho logic nghiệp vụ cốt lõi").
const validPayload = {
  name: 'Áo thun nam',
  categoryId: 'cat-1',
  attributes: [{ name: 'Màu sắc', values: [{ value: 'Đỏ' }, { value: 'Xanh' }] }],
  variants: [
    { sku: 'AT-DO', price: 100000, stock: 10, attributeValues: ['Đỏ'] },
    { sku: 'AT-XANH', price: 100000, stock: 5, attributeValues: ['Xanh'] },
  ],
};

describe('createProductSchema', () => {
  it('passes with a full valid payload', () => {
    const result = createProductSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('passes with no attributes — sản phẩm chỉ có 1 variant mặc định', () => {
    const result = createProductSchema.safeParse({
      name: 'Áo thun nam',
      categoryId: 'cat-1',
      variants: [{ sku: 'AT-1', price: 100000, stock: 10, attributeValues: [] }],
    });
    expect(result.success).toBe(true);
  });

  it('fails when there are 0 variants', () => {
    const result = createProductSchema.safeParse({
      name: 'Áo thun nam',
      categoryId: 'cat-1',
      variants: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('product.validationVariantsMin');
    }
  });

  it('fails when 2 attribute cùng tên bị lặp lại', () => {
    const result = createProductSchema.safeParse({
      ...validPayload,
      attributes: [
        { name: 'Màu sắc', values: [{ value: 'Đỏ' }] },
        { name: 'Màu sắc', values: [{ value: 'Xanh' }] },
      ],
      variants: [{ sku: 'AT-1', price: 100000, stock: 10, attributeValues: ['Đỏ'] }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        validationMessage('product.validationAttributeNameDuplicate', { name: 'Màu sắc' }),
      );
    }
  });

  // Đúng bug thật gặp trong ảnh UI seller gửi lên (đã sửa ở ProductForm.tsx
  // lẫn schema dùng chung này) — "M" và "m" phải bị coi là trùng, không chỉ
  // exact match.
  it('fails when 2 giá trị trong cùng 1 attribute trùng nhau (không phân biệt hoa/thường)', () => {
    const result = createProductSchema.safeParse({
      name: 'Áo thun nam',
      categoryId: 'cat-1',
      attributes: [{ name: 'Size', values: [{ value: 'M' }, { value: 'm' }] }],
      variants: [
        { sku: 'AT-M1', price: 100000, stock: 10, attributeValues: ['M'] },
        { sku: 'AT-M2', price: 100000, stock: 10, attributeValues: ['m'] },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        validationMessage('product.validationValueDuplicate', { value: 'm', attribute: 'Size' }),
      );
    }
  });

  it('fails when số attributeValues của variant không khớp số attribute đã khai', () => {
    const result = createProductSchema.safeParse({
      ...validPayload,
      variants: [{ sku: 'AT-1', price: 100000, stock: 10, attributeValues: [] }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('product.validationVariantValueCountMismatch');
    }
  });

  it('fails when giá trị của variant không thuộc attribute đã khai', () => {
    const result = createProductSchema.safeParse({
      ...validPayload,
      variants: [{ sku: 'AT-1', price: 100000, stock: 10, attributeValues: ['Tím'] }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        validationMessage('product.validationVariantValueNotInAttribute', {
          value: 'Tím',
          attribute: 'Màu sắc',
        }),
      );
    }
  });

  it('fails when 2 biến thể trùng tổ hợp thuộc tính', () => {
    const result = createProductSchema.safeParse({
      ...validPayload,
      variants: [
        { sku: 'AT-DO-1', price: 100000, stock: 10, attributeValues: ['Đỏ'] },
        { sku: 'AT-DO-2', price: 100000, stock: 5, attributeValues: ['Đỏ'] },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('product.validationVariantComboDuplicate');
    }
  });

  it('fails when 2 biến thể trùng SKU', () => {
    const result = createProductSchema.safeParse({
      ...validPayload,
      variants: [
        { sku: 'AT-DUP', price: 100000, stock: 10, attributeValues: ['Đỏ'] },
        { sku: 'AT-DUP', price: 100000, stock: 5, attributeValues: ['Xanh'] },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        validationMessage('product.validationSkuDuplicate', { sku: 'AT-DUP' }),
      );
    }
  });

  it('fails when giá <= 0 hoặc tồn kho âm', () => {
    const negativePrice = createProductSchema.safeParse({
      ...validPayload,
      variants: [{ sku: 'AT-1', price: 0, stock: 10, attributeValues: ['Đỏ'] }],
    });
    const negativeStock = createProductSchema.safeParse({
      ...validPayload,
      variants: [{ sku: 'AT-1', price: 1000, stock: -1, attributeValues: ['Đỏ'] }],
    });

    expect(negativePrice.success).toBe(false);
    expect(negativeStock.success).toBe(false);
  });
});

describe('updateProductSchema', () => {
  it('passes with an empty object (partial update, giữ nguyên variant hiện có)', () => {
    const result = updateProductSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('passes when chỉ gửi field cơ bản (name/status), không đụng attributes/variants', () => {
    const result = updateProductSchema.safeParse({ name: 'Tên mới', status: 'PUBLISHED' });
    expect(result.success).toBe(true);
  });

  it('fails when chỉ gửi attributes mà không gửi variants (hoặc ngược lại)', () => {
    const onlyAttributes = updateProductSchema.safeParse({
      attributes: [{ name: 'Màu sắc', values: [{ value: 'Đỏ' }] }],
    });
    const onlyVariants = updateProductSchema.safeParse({
      variants: [{ sku: 'AT-1', price: 100000, stock: 10, attributeValues: [] }],
    });

    expect(onlyAttributes.success).toBe(false);
    if (!onlyAttributes.success) {
      expect(onlyAttributes.error.issues[0].message).toBe(
        'product.validationAttributesVariantsTogether',
      );
    }
    expect(onlyVariants.success).toBe(false);
  });

  it('passes when gửi cả attributes lẫn variants cùng lúc', () => {
    const result = updateProductSchema.safeParse({
      attributes: validPayload.attributes,
      variants: validPayload.variants,
    });
    expect(result.success).toBe(true);
  });
});
