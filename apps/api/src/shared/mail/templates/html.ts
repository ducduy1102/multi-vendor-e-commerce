// Mọi giá trị người dùng/seller nhập (tên, tên sản phẩm, địa chỉ, LÝ DO TỪ CHỐI...) chèn vào email PHẢI
// qua escapeHtml — nếu không, seller gõ HTML vào lý do từ chối sẽ chèn được link/nội dung tuỳ ý vào email
// gửi tới buyer từ chính địa chỉ của sàn (phishing). Template xác thực email cũ (verify-email.template.ts)
// chưa escape tên người dùng — không đụng tới ở đây, ngoài phạm vi email đơn hàng.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const vndFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

// Tiền VND: định dạng cố định vi-VN (đúng quy ước chung của dự án, rules/frontend.md mục 6).
export function formatVnd(amount: number): string {
  return vndFormatter.format(amount);
}
