import { describe, expect, it } from 'vitest';

import { buildVariantMatrix, type VariantMatrixRow } from './ProductForm.utils';

function attr(name: string, values: string[]) {
  return { name, values: values.map((value) => ({ value })) };
}

describe('buildVariantMatrix', () => {
  it('trả về đúng 1 dòng, attributeValues rỗng khi không có attribute nào', () => {
    const result = buildVariantMatrix([], []);

    expect(result).toEqual([{ sku: '', price: '', stock: '', attributeValues: [], images: [] }]);
  });

  it('bỏ qua attribute chưa có tên hoặc chưa có giá trị nào (đang gõ dở)', () => {
    const result = buildVariantMatrix([attr('', ['Đỏ']), attr('Size', [])], []);

    expect(result).toEqual([{ sku: '', price: '', stock: '', attributeValues: [], images: [] }]);
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
      { sku: 'AO-DO', price: '100000', stock: '10', attributeValues: ['Đỏ'], images: [] },
      { sku: 'XANH', price: '', stock: '', attributeValues: ['Xanh'], images: [] },
    ]);
  });

  it('mất tổ hợp cũ (không giữ lại) khi giá trị bị xoá khỏi attribute', () => {
    const existing: VariantMatrixRow[] = [
      { sku: 'AO-DO', price: '100000', stock: '10', attributeValues: ['Đỏ'], images: [] },
      { sku: 'AO-XANH', price: '200000', stock: '5', attributeValues: ['Xanh'], images: [] },
    ];

    const result = buildVariantMatrix([attr('Màu sắc', ['Đỏ'])], existing);

    expect(result).toEqual([
      { sku: 'AO-DO', price: '100000', stock: '10', attributeValues: ['Đỏ'], images: [] },
    ]);
  });

  it('coi đổi tên giá trị là tổ hợp mới (không tái sử dụng dữ liệu cũ theo vị trí)', () => {
    const existing: VariantMatrixRow[] = [
      { sku: 'AO-DO', price: '100000', stock: '10', attributeValues: ['Đỏ'], images: [] },
    ];

    const result = buildVariantMatrix([attr('Màu sắc', ['Do-do'])], existing);

    expect(result).toEqual([
      { sku: 'DODO', price: '', stock: '', attributeValues: ['Do-do'], images: [] },
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
