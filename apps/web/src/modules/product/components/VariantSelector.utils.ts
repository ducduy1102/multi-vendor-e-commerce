import type { Product } from '../types';

export type SelectorVariant = Product['variants'][number];
export type SelectorAttribute = Product['attributes'][number];

// selectedValues: Record<attributeName, value> — 1 giá trị chọn mỗi
// attribute (không phải mảng, khớp UI chỉ chọn được 1 màu/1 size cùng lúc).
export type SelectedValues = Record<string, string>;

function matchesSelection(variant: SelectorVariant, selection: SelectedValues): boolean {
  return Object.entries(selection).every(([attributeName, value]) =>
    variant.attributeValues.some((av) => av.attributeName === attributeName && av.value === value),
  );
}

// Chỉ trả về variant khi đã chọn ĐỦ mọi attribute (khớp đúng 1 variant) —
// đúng hành vi đã chốt ở Week5.md Bước 1.15 (chưa chọn đủ combo thì FE tự
// hiện khoảng minPrice-maxPrice, không gọi hàm này). Attribute rỗng (sản
// phẩm không có biến thể theo thuộc tính) → selectedValues rỗng cũng đủ
// "khớp đủ", tự trả về variant mặc định duy nhất.
//
// isActive: false (variant đã bị soft-delete qua reconcile — Week5.md Bước
// 2.12/note-db.md) không bao giờ được coi là "khớp" — dù chọn đủ combo dẫn
// tới đúng variant đó, coi như không có variant nào bán được combo này.
export function findMatchingVariant(
  variants: SelectorVariant[],
  attributes: SelectorAttribute[],
  selectedValues: SelectedValues,
): SelectorVariant | undefined {
  if (Object.keys(selectedValues).length !== attributes.length) {
    return undefined;
  }
  return variants.find((variant) => variant.isActive && matchesSelection(variant, selectedValues));
}

// 1 giá trị (vd "Đỏ" của attribute "Màu sắc") được coi là còn chọn được nếu
// tồn tại ít nhất 1 variant active + còn hàng khớp ĐÚNG giá trị đó CỘNG với
// mọi giá trị đã chọn ở CÁC attribute khác (giữ nguyên, không đổi) — cách
// làm chuẩn của ngành (Shopee/Lazada): cố định các chiều đã chọn, chỉ kiểm
// tra khả dụng của chiều đang xét. Không yêu cầu đã chọn đủ mọi attribute
// khác — đúng ý "chưa chọn đủ combo" vẫn phải disable được option hết hàng
// (Week5.md Bước 3.2).
export function isValueAvailable(
  variants: SelectorVariant[],
  attributeName: string,
  value: string,
  selectedValues: SelectedValues,
): boolean {
  const candidate: SelectedValues = { ...selectedValues, [attributeName]: value };
  return variants.some(
    (variant) => variant.isActive && variant.stock > 0 && matchesSelection(variant, candidate),
  );
}
