import { readPositiveInt } from './read-positive-int';

describe('readPositiveInt', () => {
  const NAME = 'TEST_READ_POSITIVE_INT';

  afterEach(() => {
    delete process.env[NAME];
  });

  it('không khai biến — dùng mặc định', () => {
    expect(readPositiveInt(NAME, 7)).toBe(7);
  });

  it('khai số nguyên dương — dùng giá trị đó (có cắt khoảng trắng)', () => {
    process.env[NAME] = ' 14 ';
    expect(readPositiveInt(NAME, 7)).toBe(14);
  });

  it.each(['', '   ', '0', '-3', '2.5', 'abc'])(
    'giá trị %p (rỗng/không dương/không nguyên/không phải số) — về mặc định, không ném lỗi',
    (value) => {
      process.env[NAME] = value;
      expect(readPositiveInt(NAME, 7)).toBe(7);
    },
  );
});
