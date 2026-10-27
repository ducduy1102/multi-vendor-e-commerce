import { ADMIN_AUDIT_USER_AGENT_MAX_LENGTH } from '@ecommerce/types';
import { auditRequestContext } from './audit-request-context';

// auditRequestContext đọc IP và User-Agent của request Admin để đưa vào nhật ký. Hai bất biến: (1) không bao giờ ném —
// thiếu nguồn chỉ làm trường đó trống; (2) không bao giờ trả giá trị mà schema của nhật ký sẽ từ chối, vì User-Agent do
// client tự khai và có thể chứa bất cứ thứ gì. Ký tự đặc biệt dựng bằng String.fromCharCode để tệp không chứa ký tự điều
// khiển thật.
const NUL = String.fromCharCode(0);
const BIDI_OVERRIDE = String.fromCharCode(0x202e);

type RequestLike = Parameters<typeof auditRequestContext>[0];
const request = (
  ip: string | undefined,
  headers: RequestLike['headers'] = {},
): RequestLike => ({ ip, headers });

describe('auditRequestContext', () => {
  describe('ip', () => {
    it('lấy req.ip nguyên vẹn khi là IPv4 hoặc IPv6 hợp lệ', () => {
      expect(auditRequestContext(request('203.0.113.7')).ip).toBe(
        '203.0.113.7',
      );
      expect(auditRequestContext(request('2001:db8::1')).ip).toBe(
        '2001:db8::1',
      );
    });

    it('IPv4 ánh xạ vào IPv6 (::ffff:a.b.c.d) được đổi về dạng IPv4', () => {
      expect(auditRequestContext(request('::ffff:203.0.113.7')).ip).toBe(
        '203.0.113.7',
      );
      expect(auditRequestContext(request('::FFFF:203.0.113.7')).ip).toBe(
        '203.0.113.7',
      );
    });

    it('cắt khoảng trắng hai đầu', () => {
      expect(auditRequestContext(request(' 203.0.113.7 ')).ip).toBe(
        '203.0.113.7',
      );
    });

    it.each([
      ['thiếu', undefined],
      ['rỗng', ''],
      ['không phải địa chỉ', 'unknown'],
      ['chứa HTML', '<b>1.2.3.4</b>'],
    ])('req.ip %s ⇒ không có trường ip (không ném)', (_name, ip) => {
      const context = auditRequestContext(request(ip));

      expect(context).not.toHaveProperty('ip');
    });

    it('KHÔNG tin X-Forwarded-For tự gửi: chỉ dùng req.ip (đã qua cơ chế trust proxy của Express)', () => {
      const context = auditRequestContext(
        request('203.0.113.7', { 'x-forwarded-for': '10.0.0.1' }),
      );

      expect(context.ip).toBe('203.0.113.7');
    });
  });

  describe('userAgent', () => {
    it('giữ nguyên User-Agent trình duyệt thật', () => {
      const ua =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

      expect(
        auditRequestContext(request('203.0.113.7', { 'user-agent': ua }))
          .userAgent,
      ).toBe(ua);
    });

    it('thiếu hoặc rỗng ⇒ không có trường userAgent', () => {
      expect(auditRequestContext(request('203.0.113.7'))).not.toHaveProperty(
        'userAgent',
      );
      expect(
        auditRequestContext(request('203.0.113.7', { 'user-agent': '   ' })),
      ).not.toHaveProperty('userAgent');
    });

    it('xuống dòng, NUL và bidi-override bị làm sạch: kết quả là MỘT dòng an toàn (chống chèn dòng giả vào log)', () => {
      const context = auditRequestContext(
        request('203.0.113.7', {
          'user-agent': `Mozilla/5.0\r\nX-Injected: 1${NUL}${BIDI_OVERRIDE}\tend`,
        }),
      );

      expect(context.userAgent).toBe('Mozilla/5.0 X-Injected: 1 end');
    });

    it(`chuỗi dài bị cắt đúng ${ADMIN_AUDIT_USER_AGENT_MAX_LENGTH} ký tự và kết thúc bằng …`, () => {
      const context = auditRequestContext(
        request('203.0.113.7', { 'user-agent': 'a'.repeat(5000) }),
      );

      expect(context.userAgent).toHaveLength(ADMIN_AUDIT_USER_AGENT_MAX_LENGTH);
      expect(context.userAgent?.endsWith('…')).toBe(true);
    });

    it('chỉ gồm ký tự điều khiển ⇒ không có trường userAgent', () => {
      expect(
        auditRequestContext(
          request('203.0.113.7', { 'user-agent': `${NUL}${BIDI_OVERRIDE}` }),
        ),
      ).not.toHaveProperty('userAgent');
    });
  });

  it('request không có gì cả ⇒ object rỗng, không ném', () => {
    expect(auditRequestContext(request(undefined))).toEqual({});
  });
});
