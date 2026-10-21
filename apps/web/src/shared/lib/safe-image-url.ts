// `logoUrl`/`bannerUrl` do CHỦ SHOP tự nhập (bất kỳ URL nào, không chỉ Cloudinary). Schema ở BE chỉ nhận
// `https://` từ Tuần 9 (5.2) nhưng đó chỉ chặn lúc NHẬP: DB có thể còn URL cũ, hoặc được ghi bằng đường
// khác — nên trang công khai tự kiểm lại lúc RENDER (phòng thủ lớp hai) thay vì tin dữ liệu đã lưu.
// `javascript:`, `data:`, `file:`, `http:` (nội dung hỗn hợp trên trang https) đều bị loại ⇒ null, nơi dùng
// rơi về ảnh thay thế.
export function toSafeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
