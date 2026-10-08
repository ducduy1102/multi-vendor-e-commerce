import { maskReviewerName } from './review-name';

describe('maskReviewerName', () => {
  it('giữ chữ cái đầu + "***"', () => {
    expect(maskReviewerName('Nguyễn Văn A')).toBe('N***');
    expect(maskReviewerName('alice')).toBe('a***');
  });

  it('không lộ phần còn lại của tên (kể cả tên một chữ cái)', () => {
    expect(maskReviewerName('Nguyễn Văn A')).not.toContain('guyễn');
    expect(maskReviewerName('B')).toBe('B***');
  });

  it('cắt khoảng trắng đầu tên', () => {
    expect(maskReviewerName('   Trần Thị B  ')).toBe('T***');
  });

  it('chữ cái đầu có dấu giữ nguyên dấu — kể cả khi tên lưu dạng tổ hợp (NFD)', () => {
    const decomposed = 'Ế'.normalize('NFD'); // E + dấu mũ + dấu sắc rời
    expect(decomposed.length).toBeGreaterThan(1);

    expect(maskReviewerName(`${decomposed}n Nguyễn`)).toBe('Ế***');
    expect(maskReviewerName('Đặng Văn C')).toBe('Đ***');
  });

  it('ký tự ngoài BMP (emoji) không bị cắt đôi', () => {
    expect(maskReviewerName('😀 Vui vẻ')).toBe('😀***');
  });

  it.each([undefined, null, '', '   '])(
    'tên trống (%p) ⇒ chỉ "***", không ném lỗi',
    (name) => {
      expect(maskReviewerName(name)).toBe('***');
    },
  );
});
