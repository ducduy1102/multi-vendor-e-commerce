// Tên người đánh giá hiển thị công khai (Week9.md 1.8): CHỈ chữ cái đầu + "***". Che ở BE — response không
// bao giờ chứa tên đầy đủ, userId hay email, nên FE (và bất kỳ ai đọc API) không có gì để lộ.
//
// Chuẩn hoá NFC trước: tên tiếng Việt có thể được lưu dạng tổ hợp (chữ + dấu rời), lấy "ký tự đầu" của dạng
// đó sẽ ra chữ cái trần mất dấu ("Ế" → "E"). Duyệt theo code point (Array.from) để không cắt đôi một ký tự
// ngoài BMP (emoji...). Tên rỗng/toàn khoảng trắng ⇒ chỉ "***".
export function maskReviewerName(name: string | null | undefined): string {
  const first = Array.from((name ?? '').trim().normalize('NFC'))[0];
  return first ? `${first}***` : '***';
}
