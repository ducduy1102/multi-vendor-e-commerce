import { parseManagedImageUrl } from './cloudinary-url';

const CLOUD = 'ducduydev';
const base = `https://res.cloudinary.com/${CLOUD}/image/upload`;

describe('parseManagedImageUrl', () => {
  it('secure_url đúng dạng Cloudinary trả về: lấy public_id (bỏ version và đuôi file)', () => {
    expect(
      parseManagedImageUrl(
        `${base}/v1792372175/multi-vendor-ecommerce/gzi6axadd4i5ypmjnkoz.jpg`,
        CLOUD,
      ),
    ).toBe('multi-vendor-ecommerce/gzi6axadd4i5ypmjnkoz');
  });

  it.each(['jpg', 'webp', 'png', 'avif'])('đuôi .%s đều nhận', (ext) => {
    expect(
      parseManagedImageUrl(
        `${base}/v1/multi-vendor-ecommerce/abc_DEF-123.${ext}`,
        CLOUD,
      ),
    ).toBe('multi-vendor-ecommerce/abc_DEF-123');
  });

  it('không có đoạn version vẫn nhận', () => {
    expect(
      parseManagedImageUrl(`${base}/multi-vendor-ecommerce/abc123.jpg`, CLOUD),
    ).toBe('multi-vendor-ecommerce/abc123');
  });

  describe('KHÔNG phải ảnh của mình ⇒ null (nơi gọi không bao giờ xoá)', () => {
    it.each([
      [
        'cloud khác (vd ảnh mẫu demo)',
        'https://res.cloudinary.com/demo/image/upload/v1/multi-vendor-ecommerce/abc.jpg',
      ],
      ['thư mục khác trong cùng cloud', `${base}/v1/thu-muc-khac/abc.jpg`],
      ['ảnh ở gốc cloud', `${base}/v1/sample.jpg`],
      [
        'host khác',
        `https://evil.example/${CLOUD}/image/upload/v1/multi-vendor-ecommerce/abc.jpg`,
      ],
      [
        'http thường (không phải https)',
        `http://res.cloudinary.com/${CLOUD}/image/upload/v1/multi-vendor-ecommerce/abc.jpg`,
      ],
      [
        'URL đã biến đổi (đoạn transformation)',
        `${base}/c_fill,w_100/v1/multi-vendor-ecommerce/abc.jpg`,
      ],
      ['có query string', `${base}/v1/multi-vendor-ecommerce/abc.jpg?x=1`],
      ['có fragment', `${base}/v1/multi-vendor-ecommerce/abc.jpg#frag`],
      [
        'thử đi lên thư mục cha',
        `${base}/v1/multi-vendor-ecommerce/../khac/abc.jpg`,
      ],
      [
        'public_id lồng thư mục con',
        `${base}/v1/multi-vendor-ecommerce/con/abc.jpg`,
      ],
      ['không có đuôi file', `${base}/v1/multi-vendor-ecommerce/abc`],
      [
        'loại tài nguyên khác (video)',
        `https://res.cloudinary.com/${CLOUD}/video/upload/v1/multi-vendor-ecommerce/abc.mp4`,
      ],
      ['chuỗi rỗng', ''],
      ['không phải URL', 'khong-phai-url'],
      [
        'tên cloud đứng trước chuỗi dài hơn (không khớp tiền tố)',
        `https://res.cloudinary.com/${CLOUD}x/image/upload/v1/multi-vendor-ecommerce/abc.jpg`,
      ],
    ])('%s', (_label, url) => {
      expect(parseManagedImageUrl(url, CLOUD)).toBeNull();
    });
  });

  it('cloud name chứa ký tự đặc biệt của regex được escape (không khớp nhầm)', () => {
    expect(
      parseManagedImageUrl(
        'https://res.cloudinary.com/axb/image/upload/v1/multi-vendor-ecommerce/abc.jpg',
        'a.b',
      ),
    ).toBeNull();
    expect(
      parseManagedImageUrl(
        'https://res.cloudinary.com/a.b/image/upload/v1/multi-vendor-ecommerce/abc.jpg',
        'a.b',
      ),
    ).toBe('multi-vendor-ecommerce/abc');
  });

  it('chưa cấu hình cloud name (rỗng): không nhận gì', () => {
    expect(
      parseManagedImageUrl(`${base}/v1/multi-vendor-ecommerce/abc.jpg`, ''),
    ).toBeNull();
  });
});
