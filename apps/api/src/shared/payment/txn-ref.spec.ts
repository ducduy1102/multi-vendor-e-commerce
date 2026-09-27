import { generateTxnRef } from './txn-ref';

describe('generateTxnRef', () => {
  it('20 ký tự chữ HOA + số (thoả vnp_TxnRef của VNPay và regex orderId của Momo)', () => {
    for (let i = 0; i < 200; i++) {
      const ref = generateTxnRef();
      expect(ref).toMatch(/^[A-Z0-9]{20}$/);
      expect(ref).toMatch(/^[0-9a-zA-Z]([-_.]*[0-9a-zA-Z]+)*$/);
    }
  });

  it('không trùng nhau (20.000 lần sinh)', () => {
    const refs = new Set(
      Array.from({ length: 20_000 }, () => generateTxnRef()),
    );
    expect(refs.size).toBe(20_000);
  });

  it('dùng cả chữ lẫn số (không suy biến về 1 nhóm ký tự)', () => {
    const joined = Array.from({ length: 200 }, () => generateTxnRef()).join('');
    expect(joined).toMatch(/[A-Z]/);
    expect(joined).toMatch(/[0-9]/);
  });
});
