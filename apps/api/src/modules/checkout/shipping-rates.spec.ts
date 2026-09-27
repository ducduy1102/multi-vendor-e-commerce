import { VIETNAM_PROVINCES } from '@ecommerce/types';
import {
  calculateShippingFee,
  DEFAULT_ITEM_WEIGHT_GRAM,
  DEFAULT_SHIPPING_RATES,
  readDefaultOriginProvince,
  type ShippingRates,
} from './shipping-rates';

// Bảng giá nhỏ tự dựng để kiểm CÔNG THỨC, không khoá cứng số tiền của bảng mặc định (Week7.md 1.7).
const RATES: ShippingRates = {
  INTRA_PROVINCE: { baseFee: 100, feePerTier: 10 },
  INTRA_REGION: { baseFee: 200, feePerTier: 20 },
  INTER_REGION: { baseFee: 300, feePerTier: 30 },
};

const HCM = 'Hồ Chí Minh'; // south
const CAN_THO = 'Cần Thơ'; // south, khác tỉnh
const HA_NOI = 'Hà Nội'; // north

const oneItem = (weightGram: number | null, quantity = 1) => [
  { weightGram, quantity },
];

describe('calculateShippingFee — công thức', () => {
  it('đúng 1.000 g — không tính bậc vượt', () => {
    const fee = calculateShippingFee(
      { originProvince: HCM, destinationProvince: HCM, items: oneItem(1000) },
      RATES,
    );
    expect(fee).toBe(100);
  });

  it('1.001 g — bắt đầu vượt tính ngay 1 bậc (làm tròn lên)', () => {
    const fee = calculateShippingFee(
      { originProvince: HCM, destinationProvince: HCM, items: oneItem(1001) },
      RATES,
    );
    expect(fee).toBe(110);
  });

  it('đúng 1.500 g — vẫn chỉ 1 bậc (500 g vượt tròn)', () => {
    const fee = calculateShippingFee(
      { originProvince: HCM, destinationProvince: HCM, items: oneItem(1500) },
      RATES,
    );
    expect(fee).toBe(110);
  });

  it('1.501 g — sang bậc thứ 2', () => {
    const fee = calculateShippingFee(
      { originProvince: HCM, destinationProvince: HCM, items: oneItem(1501) },
      RATES,
    );
    expect(fee).toBe(120);
  });

  it('dưới 1.000 g — vẫn tính giá cơ bản, không âm bậc', () => {
    const fee = calculateShippingFee(
      { originProvince: HCM, destinationProvince: HCM, items: oneItem(1) },
      RATES,
    );
    expect(fee).toBe(100);
  });

  it('nhiều dòng, nhiều số lượng — cộng dồn cân nặng trước khi tính bậc', () => {
    const fee = calculateShippingFee(
      {
        originProvince: HCM,
        destinationProvince: HCM,
        items: [
          { weightGram: 400, quantity: 2 }, // 800
          { weightGram: 300, quantity: 1 }, // 300 => tổng 1100 => vượt 100 => 1 bậc
        ],
      },
      RATES,
    );
    expect(fee).toBe(110);
  });

  it('số lượng lớn không tràn/không âm', () => {
    const fee = calculateShippingFee(
      {
        originProvince: HCM,
        destinationProvince: HCM,
        items: oneItem(200, 100_000),
      },
      RATES,
    );
    // tổng = 20.000.000 g, vượt 19.999.000 g => ceil(19999000/500)=39998 bậc
    expect(fee).toBe(100 + 39_998 * 10);
    expect(Number.isFinite(fee)).toBe(true);
    expect(fee).toBeGreaterThan(0);
  });

  it('weightGram null — dùng cân nặng mặc định', () => {
    const withDefault = calculateShippingFee(
      {
        originProvince: HCM,
        destinationProvince: HCM,
        items: oneItem(DEFAULT_ITEM_WEIGHT_GRAM, 3),
      },
      RATES,
    );
    const withNull = calculateShippingFee(
      {
        originProvince: HCM,
        destinationProvince: HCM,
        items: oneItem(null, 3),
      },
      RATES,
    );
    expect(withNull).toBe(withDefault);
  });
});

describe('calculateShippingFee — tuyến', () => {
  it('cùng tỉnh/thành ⇒ nội tỉnh', () => {
    expect(
      calculateShippingFee(
        { originProvince: HCM, destinationProvince: HCM, items: oneItem(500) },
        RATES,
      ),
    ).toBe(100);
  });

  it('cùng miền khác tỉnh ⇒ nội miền', () => {
    expect(
      calculateShippingFee(
        {
          originProvince: HCM,
          destinationProvince: CAN_THO,
          items: oneItem(500),
        },
        RATES,
      ),
    ).toBe(200);
  });

  it('khác miền ⇒ liên miền', () => {
    expect(
      calculateShippingFee(
        {
          originProvince: HCM,
          destinationProvince: HA_NOI,
          items: oneItem(500),
        },
        RATES,
      ),
    ).toBe(300);
  });

  it('thứ tự phí của cùng 1 kiện: nội tỉnh < nội miền < liên miền', () => {
    const item = oneItem(1500);
    const intra = calculateShippingFee(
      { originProvince: HCM, destinationProvince: HCM, items: item },
      RATES,
    );
    const region = calculateShippingFee(
      { originProvince: HCM, destinationProvince: CAN_THO, items: item },
      RATES,
    );
    const inter = calculateShippingFee(
      { originProvince: HCM, destinationProvince: HA_NOI, items: item },
      RATES,
    );
    expect(intra).toBeLessThan(region);
    expect(region).toBeLessThan(inter);
  });

  it.each([
    'hồ chí minh',
    'HO CHI MINH',
    'Thành phố Hồ Chí Minh',
    '  Hồ Chí Minh  ',
  ])('cùng tỉnh dù viết hoa/thiếu dấu/khoảng trắng: %s', (variant) => {
    expect(
      calculateShippingFee(
        {
          originProvince: variant,
          destinationProvince: HCM,
          items: oneItem(500),
        },
        RATES,
      ),
    ).toBe(100);
  });

  it('tỉnh giao không nhận ra ⇒ liên miền (đắt nhất), không ném lỗi', () => {
    expect(() =>
      calculateShippingFee(
        {
          originProvince: HCM,
          destinationProvince: 'Atlantis',
          items: oneItem(500),
        },
        RATES,
      ),
    ).not.toThrow();
    expect(
      calculateShippingFee(
        {
          originProvince: HCM,
          destinationProvince: 'Atlantis',
          items: oneItem(500),
        },
        RATES,
      ),
    ).toBe(300);
  });

  describe('tỉnh gửi không nhận ra — dùng tỉnh gửi mặc định', () => {
    const original = process.env.SHIPPING_DEFAULT_ORIGIN_PROVINCE;
    afterEach(() => {
      if (original === undefined)
        delete process.env.SHIPPING_DEFAULT_ORIGIN_PROVINCE;
      else process.env.SHIPPING_DEFAULT_ORIGIN_PROVINCE = original;
    });

    it('mặc định (chưa cấu hình ENV) là Hồ Chí Minh', () => {
      delete process.env.SHIPPING_DEFAULT_ORIGIN_PROVINCE;
      expect(readDefaultOriginProvince()).toBe('Hồ Chí Minh');
    });

    it('tỉnh gửi lạ ⇒ thay bằng mặc định rồi tính route bình thường (không tự nhảy liên miền)', () => {
      const fee = calculateShippingFee(
        {
          originProvince: 'Atlantis',
          destinationProvince: HCM,
          items: oneItem(500),
        },
        RATES,
      );
      expect(fee).toBe(100); // mặc định = Hồ Chí Minh, trùng nơi nhận => nội tỉnh
    });

    it('ENV rỗng (khai `VAR=`) vẫn rơi về mặc định (không dùng ??)', () => {
      process.env.SHIPPING_DEFAULT_ORIGIN_PROVINCE = '   ';
      expect(readDefaultOriginProvince()).toBe('Hồ Chí Minh');
    });

    it('ENV cấu hình được', () => {
      process.env.SHIPPING_DEFAULT_ORIGIN_PROVINCE = 'Hà Nội';
      expect(readDefaultOriginProvince()).toBe('Hà Nội');
      expect(
        calculateShippingFee(
          {
            originProvince: 'Atlantis',
            destinationProvince: HA_NOI,
            items: oneItem(500),
          },
          RATES,
        ),
      ).toBe(100); // nội tỉnh vì mặc định giờ là Hà Nội
    });
  });
});

describe('DEFAULT_SHIPPING_RATES — test cấu trúc', () => {
  const routes = ['INTRA_PROVINCE', 'INTRA_REGION', 'INTER_REGION'] as const;

  it('đủ 3 tuyến, số nguyên dương', () => {
    for (const route of routes) {
      expect(Number.isInteger(DEFAULT_SHIPPING_RATES[route].baseFee)).toBe(
        true,
      );
      expect(DEFAULT_SHIPPING_RATES[route].baseFee).toBeGreaterThan(0);
      expect(Number.isInteger(DEFAULT_SHIPPING_RATES[route].feePerTier)).toBe(
        true,
      );
      expect(DEFAULT_SHIPPING_RATES[route].feePerTier).toBeGreaterThan(0);
    }
  });

  it('giá nội tỉnh ≤ nội miền ≤ liên miền, cho cả giá cơ bản lẫn giá mỗi bậc', () => {
    expect(DEFAULT_SHIPPING_RATES.INTRA_PROVINCE.baseFee).toBeLessThanOrEqual(
      DEFAULT_SHIPPING_RATES.INTRA_REGION.baseFee,
    );
    expect(DEFAULT_SHIPPING_RATES.INTRA_REGION.baseFee).toBeLessThanOrEqual(
      DEFAULT_SHIPPING_RATES.INTER_REGION.baseFee,
    );
    expect(
      DEFAULT_SHIPPING_RATES.INTRA_PROVINCE.feePerTier,
    ).toBeLessThanOrEqual(DEFAULT_SHIPPING_RATES.INTRA_REGION.feePerTier);
    expect(DEFAULT_SHIPPING_RATES.INTRA_REGION.feePerTier).toBeLessThanOrEqual(
      DEFAULT_SHIPPING_RATES.INTER_REGION.feePerTier,
    );
  });

  it('mọi tỉnh trong danh sách 1.8 đều xác định được miền (không lệch qua liên miền oan uổng)', () => {
    for (const province of VIETNAM_PROVINCES) {
      const fee = calculateShippingFee({
        originProvince: province.name,
        destinationProvince: province.name,
        items: oneItem(500),
      });
      expect(fee).toBe(DEFAULT_SHIPPING_RATES.INTRA_PROVINCE.baseFee);
    }
  });

  it('ví dụ tham khảo trong Week7.md 1.7: kiện 1,7 kg — nội tỉnh 20.500 / nội miền 26.000 / liên miền 32.000', () => {
    const item = oneItem(1700);
    expect(
      calculateShippingFee({
        originProvince: HCM,
        destinationProvince: HCM,
        items: item,
      }),
    ).toBe(20_500);
    expect(
      calculateShippingFee({
        originProvince: HCM,
        destinationProvince: CAN_THO,
        items: item,
      }),
    ).toBe(26_000);
    expect(
      calculateShippingFee({
        originProvince: HCM,
        destinationProvince: HA_NOI,
        items: item,
      }),
    ).toBe(32_000);
  });
});
