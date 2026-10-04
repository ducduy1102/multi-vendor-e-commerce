import { describe, expect, it } from 'vitest';

import { readJwtRole } from './read-jwt-role';

function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Token giả đúng hình dạng header.payload.signature — chữ ký không bao giờ được kiểm.
function makeToken(payload: unknown): string {
  return `${toBase64Url('{"alg":"HS256","typ":"JWT"}')}.${toBase64Url(JSON.stringify(payload))}.signature`;
}

describe('readJwtRole', () => {
  it.each(['ADMIN', 'USER'])('đọc đúng role %s từ payload', (role) => {
    expect(readJwtRole(makeToken({ sub: 'user-1', role, iat: 1, exp: 2 }))).toBe(role);
  });

  it('payload base64url cần padding và chứa ký tự - _ vẫn giải mã được', () => {
    // sub dài/ký tự lạ làm base64 có `+`/`/` trước khi chuyển sang base64url.
    const token = makeToken({ sub: '???>>>~~~', role: 'ADMIN' });
    expect(token.split('.')[1]).toMatch(/[-_]/);
    expect(readJwtRole(token)).toBe('ADMIN');
  });

  it.each([
    ['undefined', undefined],
    ['chuỗi rỗng', ''],
    ['không đủ 3 phần', 'abc.def'],
    ['quá 3 phần', 'a.b.c.d'],
    ['payload không phải base64', 'a.@@@.c'],
    ['payload không phải JSON', `a.${toBase64Url('not json')}.c`],
    ['payload là mảng', makeToken(['ADMIN'])],
    ['payload không có role', makeToken({ sub: 'user-1' })],
    ['role không phải chuỗi', makeToken({ role: 1 })],
    ['role null', makeToken({ role: null })],
  ])('%s -> null, không ném lỗi', (_label, token) => {
    expect(readJwtRole(token)).toBeNull();
  });
});
