// Hàng tab cuộn ngang ở màn hẹp (dưới `sm`): mờ 32px ở mép phải để người dùng biết còn mục khuất (responsive.md R10). Trước đây hàng bị
// cắt thẳng qua chữ — ở 375px thanh /admin khuất 52px, tab "Đã khoá" khuất 11px — và không có dấu hiệu nào cho thấy còn mục.
// `pr-8` (cùng 32px) chừa chỗ SAU tab cuối nên kéo hết cỡ thì tab cuối nằm ngoài vùng mờ. Chỉ áp dưới `sm`: từ đó hàng vừa khung nên
// một lớp mờ cố định sẽ chỉ làm mờ đuôi đường kẻ dưới hàng tab.
export const ADMIN_TAB_FADE_CLASS =
  'max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%_-_2rem),transparent)] max-sm:[-webkit-mask-image:linear-gradient(to_right,#000_calc(100%_-_2rem),transparent)]';

// Khung cuộn của hai hàng tab link (`?status=` ở /admin/shops, `?tab=` ở /admin/refunds).
export const ADMIN_TAB_SCROLL_CLASS = `-mx-4 overflow-x-auto pr-8 pl-4 sm:mx-0 sm:px-0 ${ADMIN_TAB_FADE_CLASS}`;
