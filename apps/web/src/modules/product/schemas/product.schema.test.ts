import { PRODUCT_VARIANT_MAX_IMAGES, validationMessage } from '@ecommerce/types';
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

  // Week10.md 2.4: trần số ảnh mỗi biến thể được ép ở ProductService (API), KHÔNG ở schema Zod này. Lý do: luật là
  // "không được THÊM ảnh vượt trần" — biến thể cũ đã vượt trần vẫn phải lưu được nếu không tăng thêm, mà schema
  // dùng chung chỉ nhìn một payload nên không biết số ảnh hiện có. Test khoá lại để ai thêm .max() vào schema
  // (làm hỏng việc sửa sản phẩm cũ) bị bắt ngay.
  describe('số ảnh mỗi biến thể', () => {
    const imageUrls = (count: number) =>
      Array.from(
        { length: count },
        (_, i) => `https://res.cloudinary.com/demo/image/upload/${i}.webp`,
      );
    const withImages = (images: string[]) => ({
      ...validPayload,
      variants: [{ ...validPayload.variants[0], images }],
    });

    it('đúng trần và vượt trần đều qua schema (trần ép ở ProductService, có grandfather cho dữ liệu cũ)', () => {
      for (const count of [0, PRODUCT_VARIANT_MAX_IMAGES, PRODUCT_VARIANT_MAX_IMAGES + 3]) {
        expect(createProductSchema.safeParse(withImages(imageUrls(count))).success).toBe(true);
      }
    });

    it('updateProductSchema cũng không giới hạn số ảnh (sản phẩm cũ đang vượt trần vẫn lưu được)', () => {
      const result = updateProductSchema.safeParse({
        attributes: validPayload.attributes,
        variants: [
          { ...validPayload.variants[0], images: imageUrls(PRODUCT_VARIANT_MAX_IMAGES + 3) },
          validPayload.variants[1],
        ],
      });

      expect(result.success).toBe(true);
    });

    it('URL ảnh vẫn phải hợp lệ', () => {
      const result = createProductSchema.safeParse(withImages(['khong-phai-url']));

      expect(result.success).toBe(false);
    });

    it('không gửi images: mặc định mảng rỗng, vẫn hợp lệ', () => {
      expect(createProductSchema.safeParse(validPayload).success).toBe(true);
    });
  });
});
