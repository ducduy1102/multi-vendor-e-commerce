import {
  findProvince,
  getProvinceRegion,
  normalizeProvinceKey,
  VIETNAM_PROVINCES,
} from '@ecommerce/types';

// Test cấu trúc dữ liệu 34 tỉnh/thành dùng chung (packages/types chưa có test runner riêng nên
// đặt ở đây, cạnh nơi dùng chính là tính phí ship). Week7.md 1.8.

const MUNICIPALITIES = [
  'Hà Nội',
  'Hồ Chí Minh',
  'Hải Phòng',
  'Đà Nẵng',
  'Cần Thơ',
  'Huế',
];

describe('VIETNAM_PROVINCES', () => {
  it('đúng 34 đơn vị: 28 tỉnh + 6 thành phố trực thuộc trung ương', () => {
    expect(VIETNAM_PROVINCES).toHaveLength(34);
    expect(VIETNAM_PROVINCES.filter((p) => p.type === 'province')).toHaveLength(
      28,
    );
    expect(
      VIETNAM_PROVINCES.filter((p) => p.type === 'municipality'),
    ).toHaveLength(6);
  });

  it('6 thành phố trực thuộc trung ương đúng danh sách', () => {
    const names = VIETNAM_PROVINCES.filter(
      (p) => p.type === 'municipality',
    ).map((p) => p.name);
    expect([...names].sort()).toEqual([...MUNICIPALITIES].sort());
  });

  it('code và name không trùng nhau', () => {
    expect(new Set(VIETNAM_PROVINCES.map((p) => p.code)).size).toBe(34);
    expect(new Set(VIETNAM_PROVINCES.map((p) => p.name)).size).toBe(34);
  });

  it('chuẩn hoá tên không tạo khoá trùng giữa 2 tỉnh (tra cứu không nhập nhằng)', () => {
    expect(
      new Set(VIETNAM_PROVINCES.map((p) => normalizeProvinceKey(p.name))).size,
    ).toBe(34);
  });

  it('code là slug (chữ thường, số, gạch ngang)', () => {
    for (const p of VIETNAM_PROVINCES) {
      expect(p.code).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it('mỗi tỉnh có miền; phân bố 16 Bắc / 10 Trung / 8 Nam', () => {
    const count = (region: string) =>
      VIETNAM_PROVINCES.filter((p) => p.region === region).length;
    expect(count('north')).toBe(16);
    expect(count('central')).toBe(10);
    expect(count('south')).toBe(8);
  });

  it('không còn tên đơn vị đã sáp nhập/bị bãi bỏ', () => {
    const removed = [
      'Bình Dương',
      'Bà Rịa - Vũng Tàu',
      'Hà Nam',
      'Nam Định',
      'Quảng Nam',
      'Bình Phước',
    ];
    for (const name of removed) {
      expect(findProvince(name)).toBeNull();
    }
  });
});

describe('findProvince', () => {
  it.each([
    ['Hà Nội', 'ha-noi'],
    ['ha noi', 'ha-noi'],
    ['HÀ NỘI', 'ha-noi'],
    ['  Hà   Nội  ', 'ha-noi'],
    ['Thành phố Hồ Chí Minh', 'ho-chi-minh'],
    ['TP. Hồ Chí Minh', 'ho-chi-minh'],
    ['TP Ho Chi Minh', 'ho-chi-minh'],
    ['Tỉnh Đắk Lắk', 'dak-lak'],
    ['dak lak', 'dak-lak'],
    ['Đà Nẵng', 'da-nang'],
    ['da-nang', 'da-nang'],
    ['Huế', 'hue'],
  ])('%s → %s', (input, code) => {
    expect(findProvince(input)?.code).toBe(code);
  });

  it.each(['', '   ', 'Atlantis', 'Hà', 'Hồ Chí', 'Sài Gòn'])(
    '%j → null',
    (input) => {
      expect(findProvince(input)).toBeNull();
    },
  );

  it('mọi tỉnh tra ngược ra chính nó bằng name, name không dấu và code', () => {
    for (const p of VIETNAM_PROVINCES) {
      expect(findProvince(p.name)).toBe(p);
      expect(findProvince(p.code)).toBe(p);
      expect(findProvince(p.name.toUpperCase())).toBe(p);
    }
  });
});

describe('getProvinceRegion', () => {
  it.each([
    ['Hà Nội', 'north'],
    ['Thanh Hóa', 'north'],
    ['Nghệ An', 'central'],
    ['Lâm Đồng', 'central'],
    ['Khánh Hòa', 'central'],
    ['Hồ Chí Minh', 'south'],
    ['Cà Mau', 'south'],
  ])('%s → %s', (name, region) => {
    expect(getProvinceRegion(name)).toBe(region);
  });

  it('tỉnh lạ → null (tính phí ship coi là liên miền, 1.7)', () => {
    expect(getProvinceRegion('Atlantis')).toBeNull();
  });
});
