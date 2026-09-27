import { availableStock } from './available-stock';

describe('availableStock', () => {
  it('trừ số đang giữ chỗ khỏi kho vật lý', () => {
    expect(availableStock({ stock: 10, reservedStock: 3 })).toBe(7);
  });

  it('không giữ chỗ thì bằng kho vật lý', () => {
    expect(availableStock({ stock: 10, reservedStock: 0 })).toBe(10);
  });

  it('giữ chỗ hết thì còn 0', () => {
    expect(availableStock({ stock: 4, reservedStock: 4 })).toBe(0);
  });
});
