import { Logger } from '@nestjs/common';
import { findProvince, getProvinceRegion } from '@ecommerce/types';

// Phí ship giả lập theo mặt bằng thị trường 2026 (Week7.md 1.7) — hàm THUẦN, không đụng DB, không
// gọi API ngoài. Bảng giá là DỮ LIỆU CẤU HÌNH TRONG CODE (đổi giá = deploy), tham chiếu ngày
// 26/09/2026 (xem Week7.md 1.7 cho nguồn và lý do chọn số). Không phải bảng giá thật của 1 hãng cụ
// thể — đây là mô phỏng, không dùng cho mục đích khác mà không đối chiếu lại giá thật.

export type ShippingRoute = 'INTRA_PROVINCE' | 'INTRA_REGION' | 'INTER_REGION';

export interface ShippingRouteRate {
  // Đồng, gồm sẵn 1.000 g đầu.
  baseFee: number;
  // Đồng/bậc, mỗi bậc = 500 g bắt đầu vượt (làm tròn lên).
  feePerTier: number;
}

export type ShippingRates = Record<ShippingRoute, ShippingRouteRate>;

// nội tỉnh <= nội miền <= liên miền cho cả 2 loại giá — giữ bất biến này khi đổi số (có test cấu trúc).
export const DEFAULT_SHIPPING_RATES: ShippingRates = {
  INTRA_PROVINCE: { baseFee: 16_500, feePerTier: 2_000 },
  INTRA_REGION: { baseFee: 19_000, feePerTier: 3_500 },
  INTER_REGION: { baseFee: 24_000, feePerTier: 4_000 },
};

// Cân nặng mặc định khi variant thiếu weightGram (0/11 variant có giá trị lúc thiết kế — Week7.md 1.1).
export const DEFAULT_ITEM_WEIGHT_GRAM = 500;

const BASE_WEIGHT_GRAM = 1_000; // gồm sẵn trong baseFee
const TIER_WEIGHT_GRAM = 500;

const logger = new Logger('ShippingFee');

// Nơi gửi (địa chỉ lấy hàng của shop) chưa tồn tại (Week7.md 1.1/1.7) — dùng tỉnh gửi mặc định, cấu
// hình được qua ENV, đọc LÚC DÙNG (không phải lúc module nạp, để test đổi ENV giữa các ca không dính
// giá trị cache). `?.trim() || fallback`, không `??` (rules/general.md mục 4).
export function readDefaultOriginProvince(): string {
  return process.env.SHIPPING_DEFAULT_ORIGIN_PROVINCE?.trim() || 'Hồ Chí Minh';
}

export interface ShippingItemInput {
  weightGram: number | null;
  quantity: number;
}

export interface ShippingFeeInput {
  // Tỉnh gửi (địa chỉ shop); truyền readDefaultOriginProvince() khi shop chưa có địa chỉ.
  originProvince: string;
  // Tỉnh nhận, lấy từ Address đã chọn (1.8).
  destinationProvince: string;
  items: ShippingItemInput[];
}

// Cùng tỉnh/thành ⇒ nội tỉnh; cùng miền khác tỉnh ⇒ nội miền; khác miền ⇒ liên miền. Tỉnh nhận không
// nhận ra ⇒ liên miền (đắt nhất, không đoán rẻ hơn) + cảnh báo. Tỉnh gửi không nhận ra ⇒ thay bằng
// tỉnh gửi mặc định rồi tính lại bình thường (không tự động nhảy liên miền).
function resolveRoute(
  originProvince: string,
  destinationProvince: string,
): ShippingRoute {
  const destinationRegion = getProvinceRegion(destinationProvince);
  if (destinationRegion === null) {
    logger.warn(
      `Unrecognized destination province "${destinationProvince}" — falling back to inter-region shipping fee`,
    );
    return 'INTER_REGION';
  }

  let resolvedOrigin = findProvince(originProvince);
  if (resolvedOrigin === null) {
    const fallback = readDefaultOriginProvince();
    resolvedOrigin = findProvince(fallback);
    if (resolvedOrigin === null) {
      // ENV cấu hình sai (hiếm) — vẫn không được ném lỗi làm hỏng đặt hàng.
      logger.warn(
        `Unrecognized default origin province "${fallback}" — falling back to inter-region shipping fee`,
      );
      return 'INTER_REGION';
    }
  }

  const destination = findProvince(destinationProvince);
  if (resolvedOrigin.code === destination?.code) return 'INTRA_PROVINCE';
  return resolvedOrigin.region === destinationRegion
    ? 'INTRA_REGION'
    : 'INTER_REGION';
}

function totalWeightGram(items: ShippingItemInput[]): number {
  return items.reduce(
    (sum, item) =>
      sum + (item.weightGram ?? DEFAULT_ITEM_WEIGHT_GRAM) * item.quantity,
    0,
  );
}

// phí = giá_cơ_bản(tuyến) + số_bậc_vượt × giá_mỗi_bậc(tuyến); cân nặng kiện = Σ (weightGram ?? mặc
// định) × quantity; cơ bản gồm 1.000 g đầu, mỗi 500 g BẮT ĐẦU vượt (kể cả 1 g) = 1 bậc.
export function calculateShippingFee(
  input: ShippingFeeInput,
  rates: ShippingRates = DEFAULT_SHIPPING_RATES,
): number {
  const route = resolveRoute(input.originProvince, input.destinationProvince);
  const excessGram = Math.max(
    0,
    totalWeightGram(input.items) - BASE_WEIGHT_GRAM,
  );
  const tiers = Math.ceil(excessGram / TIER_WEIGHT_GRAM);
  const { baseFee, feePerTier } = rates[route];
  return baseFee + tiers * feePerTier;
}
