import { z } from 'zod';

// 34 đơn vị hành chính cấp tỉnh hiện hành (28 tỉnh + 6 thành phố trực thuộc trung ương) theo
// Nghị quyết 202/2025/QH15, hiệu lực 12/06/2025. Cấp quận/huyện đã chấm dứt hoạt động từ
// 01/07/2025 nên địa chỉ chỉ còn 2 cấp: Tỉnh/Thành - Xã/Phường/Đặc khu (Week7.md 1.8).
//
// - `code`: slug ổn định do dự án tự đặt, KHÔNG phải mã hành chính chính thức.
// - `region`: quy ước của mô hình phí ship (1.7), KHÔNG phải số liệu chính thức — ranh giới
//   Bắc/Trung/Nam của từng hãng vận chuyển khác nhau. Chọn Bắc = từ Thanh Hóa trở ra.
export const provinceRegionSchema = z.enum(['north', 'central', 'south']);
export type ProvinceRegion = z.infer<typeof provinceRegionSchema>;

export const provinceTypeSchema = z.enum(['province', 'municipality']);
export type ProvinceType = z.infer<typeof provinceTypeSchema>;

export interface Province {
  code: string;
  name: string;
  type: ProvinceType;
  region: ProvinceRegion;
}

function province(
  code: string,
  name: string,
  region: ProvinceRegion,
  type: ProvinceType = 'province',
): Province {
  return { code, name, type, region };
}

export const VIETNAM_PROVINCES: readonly Province[] = [
  // Miền Bắc (16)
  province('ha-noi', 'Hà Nội', 'north', 'municipality'),
  province('hai-phong', 'Hải Phòng', 'north', 'municipality'),
  province('quang-ninh', 'Quảng Ninh', 'north'),
  province('bac-ninh', 'Bắc Ninh', 'north'),
  province('hung-yen', 'Hưng Yên', 'north'),
  province('ninh-binh', 'Ninh Bình', 'north'),
  province('thai-nguyen', 'Thái Nguyên', 'north'),
  province('phu-tho', 'Phú Thọ', 'north'),
  province('lao-cai', 'Lào Cai', 'north'),
  province('tuyen-quang', 'Tuyên Quang', 'north'),
  province('cao-bang', 'Cao Bằng', 'north'),
  province('lang-son', 'Lạng Sơn', 'north'),
  province('lai-chau', 'Lai Châu', 'north'),
  province('dien-bien', 'Điện Biên', 'north'),
  province('son-la', 'Sơn La', 'north'),
  province('thanh-hoa', 'Thanh Hóa', 'north'),
  // Miền Trung (10)
  province('nghe-an', 'Nghệ An', 'central'),
  province('ha-tinh', 'Hà Tĩnh', 'central'),
  province('quang-tri', 'Quảng Trị', 'central'),
  province('hue', 'Huế', 'central', 'municipality'),
  province('da-nang', 'Đà Nẵng', 'central', 'municipality'),
  province('quang-ngai', 'Quảng Ngãi', 'central'),
  province('gia-lai', 'Gia Lai', 'central'),
  province('dak-lak', 'Đắk Lắk', 'central'),
  province('khanh-hoa', 'Khánh Hòa', 'central'),
  province('lam-dong', 'Lâm Đồng', 'central'),
  // Miền Nam (8)
  province('ho-chi-minh', 'Hồ Chí Minh', 'south', 'municipality'),
  province('dong-nai', 'Đồng Nai', 'south'),
  province('tay-ninh', 'Tây Ninh', 'south'),
  province('can-tho', 'Cần Thơ', 'south', 'municipality'),
  province('vinh-long', 'Vĩnh Long', 'south'),
  province('dong-thap', 'Đồng Tháp', 'south'),
  province('ca-mau', 'Cà Mau', 'south'),
  province('an-giang', 'An Giang', 'south'),
];

// Bỏ dấu, hạ chữ thường, gộp khoảng trắng và bỏ tiền tố "Tỉnh"/"Thành phố"/"TP" để so khớp
// khoan dung: "Thành phố Hồ Chí Minh", "ho chi minh", "HO CHI MINH" đều ra cùng 1 khoá.
export function normalizeProvinceKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[.,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(tinh|thanh pho|tp) /, '');
}

const provinceByKey = new Map<string, Province>(
  VIETNAM_PROVINCES.flatMap((p) => [
    [normalizeProvinceKey(p.name), p] as const,
    [p.code.replace(/-/g, ' '), p] as const,
  ]),
);

// Tra tỉnh/thành theo tên (có/không dấu, hoa/thường) hoặc code; không thấy trả null.
export function findProvince(raw: string): Province | null {
  return provinceByKey.get(normalizeProvinceKey(raw)) ?? null;
}

export function getProvinceRegion(raw: string): ProvinceRegion | null {
  return findProvince(raw)?.region ?? null;
}
