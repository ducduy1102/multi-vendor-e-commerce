// price/stock giữ dạng string (khớp giá trị input HTML thật) — ProductForm
// tự Number() lúc submit, không coerce ở tầng này (tránh input/output type
// của react-hook-form + zodResolver lệch nhau, xem comment ở ProductForm.tsx).
export interface VariantMatrixRow {
  sku: string;
  price: string;
  stock: string;
  attributeValues: string[];
}

interface AttributeInput {
  name: string;
  values: { value: string }[];
}

function cartesianProduct(lists: string[][]): string[][] {
  return lists.reduce<string[][]>(
    (acc, list) => acc.flatMap((combo) => list.map((value) => [...combo, value])),
    [[]],
  );
}

// Tự sinh SKU gợi ý từ tổ hợp giá trị (vd "Đỏ"+"M" -> "DO-M") — chỉ áp dụng
// cho dòng MỚI (không có tổ hợp tương ứng trong variant cũ), không đè SKU
// người dùng đã tự đặt cho dòng đã tồn tại.
function suggestSku(combo: string[]): string {
  if (combo.length === 0) {
    return '';
  }
  return combo
    .map((value) =>
      value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/đ/gi, 'd')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, ''),
    )
    .join('-');
}

// Tính lại bảng ma trận variant từ danh sách attributes hiện tại, TÁI SỬ
// DỤNG sku/price/stock của variant cũ nếu tổ hợp giá trị (theo VỊ TRÍ, khớp
// đúng bất biến của createProductSchema/updateProductSchema ở
// packages/types) vẫn còn tồn tại sau khi đổi — không xoá sạch làm mất dữ
// liệu người dùng đã nhập cho các dòng chưa đổi. Attribute chưa có tên hoặc
// chưa có giá trị nào (đang gõ dở) bị bỏ qua khỏi tổ hợp, không chặn tính
// toán các attribute khác.
export function buildVariantMatrix(
  attributes: AttributeInput[],
  existingVariants: VariantMatrixRow[],
): VariantMatrixRow[] {
  const usableAttributes = attributes
    .map((attribute) => ({
      name: attribute.name.trim(),
      values: attribute.values.map((v) => v.value.trim()).filter((v) => v !== ''),
    }))
    .filter((attribute) => attribute.name !== '' && attribute.values.length > 0);

  const combos =
    usableAttributes.length === 0
      ? [[]]
      : cartesianProduct(usableAttributes.map((attribute) => attribute.values));

  const existingByCombo = new Map(
    existingVariants.map((variant) => [variant.attributeValues.join('|'), variant]),
  );

  return combos.map((combo) => {
    const key = combo.join('|');
    const existing = existingByCombo.get(key);
    if (existing) {
      return existing;
    }
    return {
      sku: suggestSku(combo),
      price: '',
      stock: '',
      attributeValues: combo,
    };
  });
}
