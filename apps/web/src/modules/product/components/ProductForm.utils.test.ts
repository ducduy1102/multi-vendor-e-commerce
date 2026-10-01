import { describe, expect, it } from 'vitest';

import { buildVariantMatrix, type VariantMatrixRow } from './ProductForm.utils';

// Đa số test chỉ cần giá trị dạng string thuần (chưa có valueId — trường
// hợp attribute mới thêm ở form, chưa từng lưu DB). Test riêng cho
// id-matching truyền thẳng { value, valueId } để mô phỏng giá trị ĐÃ TỒN TẠI
// (lấy từ productToFormValues, id thật từ response GET).
function attr(name: string, values: (string | { value: string; valueId?: string })[]) {
  return {
    name,
    values: values.map((v) => (typeof v === 'string' ? { value: v } : v)),
  };
}

describe('buildVariantMatrix', () => {
  it('trả về đúng 1 dòng, attributeValues rỗng khi không có attribute nào', () => {
    const result = buildVariantMatrix([], []);

    expect(result).toEqual([
      { sku: '', price: '', stock: '', attributeValues: [], attributeValueIds: [], images: [] },
    ]);
  });

  it('bỏ qua attribute chưa có tên hoặc chưa có giá trị nào (đang gõ dở)', () => {
    const result = buildVariantMatrix([attr('', ['Đỏ']), attr('Size', [])], []);

    expect(result).toEqual([
      { sku: '', price: '', stock: '', attributeValues: [], attributeValueIds: [], images: [] },
    ]);
  });

  it('sinh đúng tích Descartes cho 1 attribute', () => {
    const result = buildVariantMatrix([attr('Màu sắc', ['Đỏ', 'Xanh'])], []);

    expect(result.map((r) => r.attributeValues)).toEqual([['Đỏ'], ['Xanh']]);
  });

  it('sinh đúng tích Descartes cho 2 attribute (2x2 = 4 dòng, đúng thứ tự)', () => {
    const result = buildVariantMatrix(
      [attr('Màu sắc', ['Đỏ', 'Xanh']), attr('Size', ['M', 'L'])],
      [],
    );

    expect(result.map((r) => r.attributeValues)).toEqual([
      ['Đỏ', 'M'],
      ['Đỏ', 'L'],
      ['Xanh', 'M'],
      ['Xanh', 'L'],
    ]);
  });

  it('tự sinh SKU gợi ý từ tổ hợp giá trị, bỏ dấu tiếng Việt', () => {
    const result = buildVariantMatrix([attr('Màu sắc', ['Đỏ']), attr('Size', ['M'])], []);

    expect(result[0].sku).toBe('DO-M');
  });

  it('tái sử dụng sku/price/stock của variant cũ khi tổ hợp vẫn còn sau khi thêm giá trị mới', () => {
    const existing: VariantMatrixRow[] = [
      { sku: 'AO-DO', price: '100000', stock: '10', attributeValues: ['Đỏ'], images: [] },
    ];

    const result = buildVariantMatrix([attr('Màu sắc', ['Đỏ', 'Xanh'])], existing);

    expect(result).toEqual([
      {
        sku: 'AO-DO',
        price: '100000',
        stock: '10',
        attributeValues: ['Đỏ'],
        attributeValueIds: [undefined],
        images: [],
      },
      {
        sku: 'XANH',
        price: '',
        stock: '',
        attributeValues: ['Xanh'],
        attributeValueIds: [undefined],
        images: [],
      },
    ]);
  });

  it('mất tổ hợp cũ (không giữ lại) khi giá trị bị xoá khỏi attribute', () => {
    const existing: VariantMatrixRow[] = [
      { sku: 'AO-DO', price: '100000', stock: '10', attributeValues: ['Đỏ'], images: [] },
      { sku: 'AO-XANH', price: '200000', stock: '5', attributeValues: ['Xanh'], images: [] },
    ];

    const result = buildVariantMatrix([attr('Màu sắc', ['Đỏ'])], existing);

    expect(result).toEqual([
      {
        sku: 'AO-DO',
        price: '100000',
        stock: '10',
        attributeValues: ['Đỏ'],
        attributeValueIds: [undefined],
        images: [],
      },
    ]);
  });

  // Week5.md — companion fix cho bug rename-tạo-rác ở BE (product.service.ts's
  // reconcileAttributesAndVariants): match theo valueId (khi có) thay vì chỉ
  // theo text, để KHÔNG mất sku/giá/tồn kho/ảnh đã gõ dở lúc seller đổi tên 1
  // giá trị TRƯỚC KHI submit.
  it('KHÔNG có valueId: đổi tên giá trị vẫn coi là tổ hợp mới (giữ nguyên hành vi cũ)', () => {
    const existing: VariantMatrixRow[] = [
      { sku: 'AO-DO', price: '100000', stock: '10', attributeValues: ['Đỏ'], images: [] },
    ];

    const result = buildVariantMatrix([attr('Màu sắc', ['Do-do'])], existing);

    expect(result).toEqual([
      {
        sku: 'DODO',
        price: '',
        stock: '',
        attributeValues: ['Do-do'],
        attributeValueIds: [undefined],
        images: [],
      },
    ]);
  });

  it('CÓ valueId khớp: đổi tên giá trị vẫn tái sử dụng đúng dòng cũ (sku/giá/tồn kho/ảnh không mất)', () => {
    const existing: VariantMatrixRow[] = [
      {
        sku: 'AO-DO',
        price: '100000',
        stock: '10',
        attributeValues: ['Đỏ'],
        attributeValueIds: ['val-do'],
        images: ['https://x/do.jpg'],
      },
    ];

    const result = buildVariantMatrix(
      [attr('Màu sắc', [{ value: 'Đỏ tươi', valueId: 'val-do' }])],
      existing,
    );

    // sku/price/stock/images giữ nguyên của dòng cũ (val-do), NHƯNG
    // attributeValues (text gửi lên BE) phải cập nhật đúng theo tên MỚI —
    // không được để sót lại text cũ "Đỏ".
    expect(result).toEqual([
      {
        sku: 'AO-DO',
        price: '100000',
        stock: '10',
        attributeValues: ['Đỏ tươi'],
        attributeValueIds: ['val-do'],
        images: ['https://x/do.jpg'],
      },
    ]);
  });

  it('không tự dedupe khi 1 attribute khai giá trị trùng nhau — sinh 2 dòng độc lập, không chia sẻ reference', () => {
    // buildVariantMatrix KHÔNG chịu trách nhiệm chặn giá trị trùng (đó là
    // việc của productFormAttributeSchema, ProductForm.tsx) — chỉ cần đảm
    // bảo không có bug phụ nào (2 dòng share chung 1 object reference) nếu
    // validate chưa kịp chặn lúc người dùng đang gõ dở.
    const result = buildVariantMatrix([attr('Size', ['M', 'M'])], []);

    expect(result).toHaveLength(2);
    expect(result[0].attributeValues).toEqual(['M']);
    expect(result[1].attributeValues).toEqual(['M']);
    expect(result[0]).not.toBe(result[1]);
  });

  it('giữ nguyên reservedStock của dòng cũ khi tổ hợp vẫn còn, dòng mới không có reservedStock (Week7.md 1.3)', () => {
    const existing: VariantMatrixRow[] = [
      {
        sku: 'AO-DO',
        price: '100000',
        stock: '13',
        reservedStock: 3,
        attributeValues: ['Đỏ'],
        images: [],
      },
    ];

    const result = buildVariantMatrix([attr('Màu sắc', ['Đỏ', 'Xanh'])], existing);

    expect(result[0].reservedStock).toBe(3);
    expect(result[1].reservedStock).toBeUndefined();
  });

  it('giữ nguyên images đã upload của dòng cũ khi tổ hợp vẫn còn, dòng mới mảng rỗng', () => {
    const existing: VariantMatrixRow[] = [
      {
        sku: 'AO-DO',
        price: '100000',
        stock: '10',
        attributeValues: ['Đỏ'],
        images: [
          'https://res.cloudinary.com/demo/image/upload/do-1.jpg',
          'https://res.cloudinary.com/demo/image/upload/do-2.jpg',
        ],
      },
    ];

    const result = buildVariantMatrix([attr('Màu sắc', ['Đỏ', 'Xanh'])], existing);

    expect(result[0].images).toEqual([
      'https://res.cloudinary.com/demo/image/upload/do-1.jpg',
      'https://res.cloudinary.com/demo/image/upload/do-2.jpg',
    ]);
    expect(result[1].images).toEqual([]);
  });
});
