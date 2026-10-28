// Kiểu của nút CẢNH BÁO ở các hàng thao tác của khu Admin (bảng duyệt shop, hàng chờ khiếu nại): viền + chữ màu `--destructive`,
// nền trắng. Nút XÁC NHẬN trong hộp thoại của chính các hành động này là ADMIN_DESTRUCTIVE_CONFIRM_BUTTON_CLASS (nền đỏ đặc) — cùng
// họ màu, đậm hơn để nút xác nhận nổi hơn nút mở hộp thoại.
// Mọi hành động tiêu cực/hủy bỏ ("Từ chối", "Khoá", "Hủy đơn chưa giao") dùng CÙNG một kiểu cảnh báo: nút viền nhưng viền + chữ
// màu `--destructive` (4,77:1 trên nền trắng; không dùng variant `destructive` vì nền nhạt của nó chỉ đạt 3,97:1). Rê chuột chỉ
// đậm viền, KHÔNG đổi nền sang xám: chữ đỏ trên xám nhạt tụt dưới 4,5:1. Đứng cạnh nút chính màu đặc ("Duyệt", "Mở khoá") nên
// cặp đồng ý/từ chối tách bạch ngay. Không dùng accent cam cho nút nguy hiểm (rules/frontend.md "UI polish" mục 2).
export const ADMIN_CAUTION_BUTTON_CLASS =
  'border-destructive/30 text-destructive hover:border-destructive/60 hover:bg-background hover:text-destructive dark:border-destructive/40';

// Nút XÁC NHẬN của hộp thoại huỷ bỏ trong khu Admin (từ chối, khoá, cấm, hủy hàng loạt): nền đỏ đặc + chữ `--background` (trắng ở sáng
// 4,77:1; ở tối là màu nền gần đen trên đỏ sáng của chế độ tối). Variant `destructive` mặc định (nền `destructive/10`) chỉ đạt 3,81:1
// ở sáng và 4,26:1 ở tối — nó là primitive dùng chung cả app nên KHÔNG sửa ở đó (cần chạy lại các trang người mua) mà ghi đè tại hộp
// thoại admin. Dùng cùng `variant="destructive"` để giữ vòng focus; className ghi đè nền, chữ và nền khi rê chuột.
export const ADMIN_DESTRUCTIVE_CONFIRM_BUTTON_CLASS =
  'bg-destructive text-background hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90';
