// Hằng số class dùng chung giữa component thật và skeleton để hai bên không lệch nhau (rules/frontend.md mục 10).

// Khung hộp thư: chiều cao CỐ ĐỊNH theo khung nhìn để danh sách và khung tin cuộn BÊN TRONG, còn ô nhập luôn nằm
// trong tầm mắt (không phải cuộn cả trang mới thấy). Trừ phần Header + thanh tab dưới (mobile) và lề trang; có
// `min-h` để màn hình thấp (bàn phím ảo) không bóp khung về 0. Hai cột từ `md`; dưới đó là một cột (danh sách HOẶC
// hội thoại — xem ChatInbox). Cột khai tường minh `minmax(0,1fr)`: lưới trần lấy min-content của phần tử con nên một
// chuỗi dài không dấu cách sẽ làm cả cột (và cả trang) rộng bằng chuỗi (rules/frontend.md mục 5).
export const CHAT_INBOX_CLASS =
  'grid h-[calc(100dvh-13rem)] min-h-[26rem] grid-cols-1 overflow-hidden rounded-xl border border-border bg-card text-card-foreground md:h-[calc(100dvh-11rem)] md:grid-cols-[18rem_minmax(0,1fr)] lg:grid-cols-[22rem_minmax(0,1fr)]';

// Một dòng ở danh sách hội thoại: avatar | tên + tin cuối | giờ + huy hiệu. Cột giữa `minmax(0,1fr)` để
// `truncate` thật sự cắt (không đẩy rộng dòng).
export const CONVERSATION_ROW_CLASS =
  'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left';

export const AVATAR_CLASS = 'size-10 shrink-0 rounded-full';

// Skeleton chỉ mang tính trang trí: tôn trọng prefers-reduced-motion.
export const SKELETON_CLASS = 'motion-reduce:animate-none';
