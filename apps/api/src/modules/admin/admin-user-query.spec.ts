import {
  buildAdminUserWhere,
  escapeLikePattern,
  userSearchPattern,
} from './admin-user-query';

// Phần THUẦN của tìm kiếm người dùng (Week11.md 3.2). Hành vi trên Postgres thật (không dấu, hoa-thường, thứ tự, đếm) do
// admin-user.controller.int-spec.ts kiểm; ở đây khoá hai điều không cần DB: thoát ký tự đặc biệt của LIKE và việc giá trị
// người dùng nhập CHỈ đi vào tham số ràng buộc, không bao giờ vào chuỗi SQL.
describe('escapeLikePattern', () => {
  it.each([
    ['chữ thường', 'nguyen', 'nguyen'],
    ['tiếng Việt có dấu', 'Nguyễn Đức', 'Nguyễn Đức'],
    [
      'dấu @ và chấm của email',
      'an.nguyen@example.com',
      'an.nguyen@example.com',
    ],
    ['dấu phần trăm', '100%', '100\\%'],
    ['dấu gạch dưới', 'a_b', 'a\\_b'],
    ['dấu gạch chéo ngược', 'c:\\dir', 'c:\\\\dir'],
    ['cả ba cùng lúc', '%_\\', '\\%\\_\\\\'],
    ['nhiều lần liền nhau', '%%__', '\\%\\%\\_\\_'],
  ])('%s', (_name, input, expected) => {
    expect(escapeLikePattern(input)).toBe(expected);
  });

  it('không thoát hai lần: dấu `\\` được thêm vào không bị thoát lại', () => {
    expect(escapeLikePattern('%')).toBe('\\%');
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%');
  });
});

describe('userSearchPattern', () => {
  it('bọc mẫu "chứa" quanh từ khoá đã thoát', () => {
    expect(userSearchPattern('an')).toBe('%an%');
    expect(userSearchPattern('50%')).toBe('%50\\%%');
  });
});

describe('buildAdminUserWhere', () => {
  it('không có bộ lọc nào ⇒ không có mệnh đề WHERE và không tham số', () => {
    const where = buildAdminUserWhere({});

    expect(where.text).toBe('');
    expect(where.values).toEqual([]);
  });

  it('q ⇒ so khớp email VÀ tên bằng unaccent + ILIKE, cùng một mẫu cho cả hai', () => {
    const where = buildAdminUserWhere({ q: 'nguyen' });

    expect(where.text).toMatch(
      /^WHERE \(unaccent\(email\) ILIKE unaccent\(\$1::text\)/,
    );
    expect(where.text).toMatch(
      /OR unaccent\(name\) ILIKE unaccent\(\$2::text\)\)$/,
    );
    expect(where.values).toEqual(['%nguyen%', '%nguyen%']);
  });

  it('role / status ⇒ điều kiện enum có ép kiểu, giá trị là tham số', () => {
    const where = buildAdminUserWhere({ role: 'ADMIN', status: 'BANNED' });

    expect(where.text).toBe(
      'WHERE role = $1::"Role" AND account_status = $2::"AccountStatus"',
    );
    expect(where.values).toEqual(['ADMIN', 'BANNED']);
  });

  it('tổ hợp q + role + status ⇒ ba điều kiện nối bằng AND, đúng thứ tự tham số', () => {
    const where = buildAdminUserWhere({
      q: 'an',
      role: 'USER',
      status: 'SUSPENDED',
    });

    expect(where.text.split(' AND ')).toHaveLength(3);
    expect(where.values).toEqual(['%an%', '%an%', 'USER', 'SUSPENDED']);
  });

  it.each([
    ["'; DROP TABLE users; --"],
    ["' OR '1'='1"],
    ['"; SELECT pg_sleep(10); --'],
    ['$1 OR true'],
  ])(
    'từ khoá độc hại %j chỉ nằm trong tham số, không bao giờ trong câu SQL',
    (q) => {
      const where = buildAdminUserWhere({ q });

      expect(where.values).toEqual([
        `%${escapeLikePattern(q)}%`,
        `%${escapeLikePattern(q)}%`,
      ]);
      expect(where.text).not.toContain('DROP');
      expect(where.text).not.toContain('pg_sleep');
      expect(where.text).not.toContain("'1'");
      expect(where.text).toMatch(/\$1::text/);
      expect(where.text).toMatch(/\$2::text/);
    },
  );
});
