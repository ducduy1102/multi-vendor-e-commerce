import { resolveClientIp } from './resolve-client-ip';

const SOCKET = '10.0.0.1'; // địa chỉ của proxy gần server nhất
const CLIENT = '203.0.113.7';
const EDGE = '172.64.0.9'; // vd. một node Cloudflare
const SPOOF = '9.9.9.9'; // do client tự thêm vào X-Forwarded-For

describe('resolveClientIp', () => {
  describe('trustProxy = false (không tin X-Forwarded-For)', () => {
    it('luôn là địa chỉ socket, kể cả khi client tự gửi X-Forwarded-For', () => {
      expect(resolveClientIp(SPOOF, SOCKET, false)).toBe(SOCKET);
      expect(resolveClientIp(`${SPOOF}, ${CLIENT}`, SOCKET, false)).toBe(
        SOCKET,
      );
    });

    it('không có địa chỉ socket ⇒ "unknown"', () => {
      expect(resolveClientIp(undefined, undefined, false)).toBe('unknown');
      expect(resolveClientIp(SPOOF, '', false)).toBe('unknown');
    });
  });

  describe('trustProxy = N (tin N chặng proxy gần nhất)', () => {
    it('N=1: lấy phần tử CUỐI của X-Forwarded-For (do proxy tin cậy thêm vào)', () => {
      expect(resolveClientIp(CLIENT, SOCKET, 1)).toBe(CLIENT);
    });

    it('N=1: client chèn thêm IP giả ở đầu thì không đổi được kết quả', () => {
      expect(resolveClientIp(`${SPOOF}, ${CLIENT}`, SOCKET, 1)).toBe(CLIENT);
    });

    it('N=2 (vd. Cloudflare rồi Render): lấy IP trước node Cloudflare', () => {
      expect(resolveClientIp(`${CLIENT}, ${EDGE}`, SOCKET, 2)).toBe(CLIENT);
      expect(resolveClientIp(`${SPOOF}, ${CLIENT}, ${EDGE}`, SOCKET, 2)).toBe(
        CLIENT,
      );
    });

    it('cấu hình thiếu (N=1 nhưng thật sự có 2 chặng): ra IP của node biên, KHÔNG phải IP khách', () => {
      expect(resolveClientIp(`${CLIENT}, ${EDGE}`, SOCKET, 1)).toBe(EDGE);
    });

    it('chuỗi ngắn hơn N ⇒ lấy phần tử xa nhất có được', () => {
      expect(resolveClientIp(CLIENT, SOCKET, 5)).toBe(CLIENT);
      expect(resolveClientIp(undefined, SOCKET, 3)).toBe(SOCKET);
    });
  });

  describe('trustProxy = true (tin mọi chặng)', () => {
    it('lấy phần tử ngoài cùng bên trái của X-Forwarded-For', () => {
      expect(resolveClientIp(`${CLIENT}, ${EDGE}`, SOCKET, true)).toBe(CLIENT);
    });

    it('không có X-Forwarded-For ⇒ địa chỉ socket', () => {
      expect(resolveClientIp(undefined, SOCKET, true)).toBe(SOCKET);
    });
  });

  it('IPv4 viết dạng IPv6 gộp về cùng một khoá với IPv4 thường', () => {
    expect(resolveClientIp(undefined, '::ffff:203.0.113.7', false)).toBe(
      CLIENT,
    );
    expect(resolveClientIp('::FFFF:203.0.113.7', SOCKET, 1)).toBe(CLIENT);
  });

  it('bỏ qua khoảng trắng và phần tử rỗng trong X-Forwarded-For', () => {
    expect(resolveClientIp(' , 203.0.113.7 ,, ', SOCKET, 1)).toBe(CLIENT);
  });

  it('cắt độ dài giá trị do client tự khai để không phình bộ nhớ của bộ đếm', () => {
    const huge = 'a'.repeat(500);

    expect(resolveClientIp(huge, SOCKET, 1)).toHaveLength(64);
  });
});
