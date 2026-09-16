import { describe, expect, it } from 'vitest';

import { buildVariantMatrix, type VariantMatrixRow } from './ProductForm.utils';

function attr(name: string, values: string[]) {
  return { name, values: values.map((value) => ({ value })) };
}

describe('buildVariantMatrix', () => {
  it('trả về đúng 1 dòng, attributeValues rỗng khi không có attribute nào', () => {
    const result = buildVariantMatrix([], []);

    expect(result).toEqual([{ sku: '', price: '', stock: '', attributeValues: [] }]);
  });

  it('bỏ qua attribute chưa có tên hoặc chưa có giá trị nào (đang gõ dở)', () => {
    const result = buildVariantMatrix([attr('', ['Đỏ']), attr('Size', [])], []);

    expect(result).toEqual([{ sku: '', price: '', stock: '', attributeValues: [] }]);
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
      { sku: 'AO-DO', price: '100000', stock: '10', attributeValues: ['Đỏ'] },
    ];

    const result = buildVariantMatrix([attr('Màu sắc', ['Đỏ', 'Xanh'])], existing);

    expect(result).toEqual([
      { sku: 'AO-DO', price: '100000', stock: '10', attributeValues: ['Đỏ'] },
      { sku: 'XANH', price: '', stock: '', attributeValues: ['Xanh'] },
    ]);
  });

  it('mất tổ hợp cũ (không giữ lại) khi giá trị bị xoá khỏi attribute', () => {
    const existing: VariantMatrixRow[] = [
      { sku: 'AO-DO', price: '100000', stock: '10', attributeValues: ['Đỏ'] },
      { sku: 'AO-XANH', price: '200000', stock: '5', attributeValues: ['Xanh'] },
    ];

    const result = buildVariantMatrix([attr('Màu sắc', ['Đỏ'])], existing);

    expect(result).toEqual([
      { sku: 'AO-DO', price: '100000', stock: '10', attributeValues: ['Đỏ'] },
    ]);
  });

  it('coi đổi tên giá trị là tổ hợp mới (không tái sử dụng dữ liệu cũ theo vị trí)', () => {
    const existing: VariantMatrixRow[] = [
      { sku: 'AO-DO', price: '100000', stock: '10', attributeValues: ['Đỏ'] },
    ];

    const result = buildVariantMatrix([attr('Màu sắc', ['Do-do'])], existing);

    expect(result).toEqual([{ sku: 'DODO', price: '', stock: '', attributeValues: ['Do-do'] }]);
  });

  it('giữ nguyên imageUrl đã upload của dòng cũ khi tổ hợp vẫn còn, dòng mới không có ảnh', () => {
    const existing: VariantMatrixRow[] = [
      {
        sku: 'AO-DO',
        price: '100000',
        stock: '10',
        attributeValues: ['Đỏ'],
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/do.jpg',
      },
    ];

    const result = buildVariantMatrix([attr('Màu sắc', ['Đỏ', 'Xanh'])], existing);

    expect(result[0].imageUrl).toBe('https://res.cloudinary.com/demo/image/upload/do.jpg');
    expect(result[1].imageUrl).toBeUndefined();
  });
});
