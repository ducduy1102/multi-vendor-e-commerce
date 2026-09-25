// price/stock giữ dạng string (khớp giá trị input HTML thật) — ProductForm
// tự Number() lúc submit, không coerce ở tầng này (tránh input/output type
// của react-hook-form + zodResolver lệch nhau, xem comment ở ProductForm.tsx).
export interface VariantMatrixRow {
  sku: string;
  price: string;
  stock: string;
  attributeValues: string[];
  // Ảnh upload qua Cloudinary (Week5.md Bước 1.3/2.12/3.13 — nhiều ảnh/
  // variant, thay `imageUrl` đơn cũ) — chỉ dòng đã tồn tại (tái sử dụng qua
  // combo khớp) mới có sẵn ảnh, dòng mới sinh luôn mảng rỗng (chưa upload
  // ảnh nào cho tổ hợp chưa từng có).
  images: string[];
  // Key nội bộ (KHÔNG gửi lên BE) để match lại đúng dòng khi 1 giá trị thuộc
  // tính bị ĐỔI TÊN (không phải thêm/bớt) lúc đang sửa form, TRƯỚC KHI
  // submit — match theo `attributeValues` (text) sẽ coi combo đó là "mới",
  // xoá sạch sku/giá/tồn kho/ảnh đã gõ dở của dòng đó. Song song với
  // `attributeValues`, không thay thế — `attributeValues` vẫn là thứ THẬT
  // SỰ gửi lên BE. `undefined` ở 1 vị trí = giá trị đó chưa có id thật (mới
  // thêm ở form, chưa từng lưu DB).
  attributeValueIds?: (string | undefined)[];
}

interface AttributeValueInput {
  valueId?: string;
  value: string;
}

interface AttributeInput {
  name: string;
  values: AttributeValueInput[];
}

function cartesianProduct<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>(
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
// DỤNG sku/price/stock/images của variant cũ nếu tổ hợp giá trị vẫn còn tồn
// tại sau khi đổi — không xoá sạch làm mất dữ liệu người dùng đã nhập cho
// các dòng chưa đổi. Attribute chưa có tên hoặc chưa có giá trị nào (đang gõ
// dở) bị bỏ qua khỏi tổ hợp, không chặn tính toán các attribute khác.
//
// Match theo 2 tầng: ưu tiên theo `valueId` (bền vững qua rename — 1 giá trị
// ĐỔI TÊN vẫn cùng id, vẫn được coi là "cùng combo", giữ nguyên
// sku/giá/tồn kho/ảnh) khi MỌI giá trị trong combo đều có id; fallback về
// match theo TEXT (hành vi gốc) khi combo có ít nhất 1 giá trị chưa từng lưu
// (mới thêm ở form, chưa có id). `attributeValues` (text) trong kết quả trả
// về LUÔN được cập nhật đúng theo combo hiện tại (dù match theo id hay text)
// — đây là thứ thật sự gửi lên BE (ProductService.resolveAttributeValueIds
// tra theo text), không được để sót lại text CŨ của dòng match theo id.
export function buildVariantMatrix(
  attributes: AttributeInput[],
  existingVariants: VariantMatrixRow[],
): VariantMatrixRow[] {
  const usableAttributes = attributes
    .map((attribute) => ({
      name: attribute.name.trim(),
      values: attribute.values
        .map((v) => ({ valueId: v.valueId, value: v.value.trim() }))
        .filter((v) => v.value !== ''),
    }))
    .filter((attribute) => attribute.name !== '' && attribute.values.length > 0);

  const combos: AttributeValueInput[][] =
    usableAttributes.length === 0
      ? [[]]
      : cartesianProduct(usableAttributes.map((attribute) => attribute.values));

  const existingByTextCombo = new Map(
    existingVariants.map((variant) => [variant.attributeValues.join('|'), variant]),
  );
  const existingByIdCombo = new Map(
    existingVariants
      .filter(
        (variant): variant is VariantMatrixRow & { attributeValueIds: string[] } =>
          !!variant.attributeValueIds && variant.attributeValueIds.every((id) => id !== undefined),
      )
      .map((variant) => [variant.attributeValueIds.join('|'), variant]),
  );

  return combos.map((combo) => {
    const textValues = combo.map((v) => v.value);
    const textKey = textValues.join('|');
    const idKey = combo.every((v) => v.valueId !== undefined)
      ? combo.map((v) => v.valueId).join('|')
      : undefined;

    const existing =
      (idKey !== undefined ? existingByIdCombo.get(idKey) : undefined) ??
      existingByTextCombo.get(textKey);

    const attributeValueIds = combo.map((v) => v.valueId);
    if (existing) {
      // Giữ sku/price/stock/images của dòng cũ, cập nhật lại attributeValues/
      // attributeValueIds đúng combo hiện tại (quan trọng khi match theo id
      // nhưng text vừa đổi — không được giữ text cũ).
      return { ...existing, attributeValues: textValues, attributeValueIds };
    }
    return {
      sku: suggestSku(textValues),
      price: '',
      stock: '',
      attributeValues: textValues,
      attributeValueIds,
      images: [],
    };
  });
}
