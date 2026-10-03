// Dùng chung giữa OrderCard (dòng hàng thật) và OrderListSkeleton để 2 bên không lệch kích thước
// khi dữ liệu về (rules/frontend.md mục 10 — chung hằng số class giữa bản thật và skeleton).
export const ORDER_ITEM_THUMB_CLASS = 'size-12 shrink-0 rounded-md';

export const ORDER_CARD_CLASS = 'overflow-hidden rounded-lg border border-border bg-background';

export const ORDER_CARD_HEADER_CLASS =
  'flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2 sm:px-4';

export const ORDER_CARD_ITEM_ROW_CLASS = 'flex items-center gap-3 px-3 py-2.5 sm:px-4';

export const ORDER_CARD_SUMMARY_CLASS =
  'flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-t border-border px-3 py-2 sm:px-4';

export const ORDER_CARD_FOOTER_CLASS =
  'flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 sm:px-4';

// Trang chi tiết: 1 cột trên mobile, từ lg là cột nội dung chính + cột phụ cố định 20rem. Dùng chung
// giữa OrderDetailView và OrderDetailSkeleton.
export const ORDER_DETAIL_GRID_CLASS =
  'grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start';

export const ORDER_DETAIL_COLUMN_CLASS = 'flex flex-col gap-4';

export const ORDER_DETAIL_SECTION_TITLE_CLASS =
  'border-b border-border bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground sm:px-4';

export const ORDER_DETAIL_SECTION_BODY_CLASS = 'px-3 py-3 sm:px-4';
