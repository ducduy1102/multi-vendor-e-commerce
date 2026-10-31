// Kháng nghị áp dụng cho hai loại đối tượng: shop bị khoá (Week11.md 4.6) và sản phẩm bị gỡ (5.8). Luồng giống hệt nhau (một hộp thoại
// có đếm ký tự, lịch sử kèm phản hồi từ sàn, mỗi lần bị xử lý chỉ một kháng nghị) nên dùng CHUNG component; chỉ lời văn khác. Bảng này
// là nơi DUY NHẤT nói "loại nào dùng khoá dịch nào" (namespace `appeal`) — component nhận `kind` rồi tra ở đây, không rải `if` theo loại.
// Khoá của shop giữ nguyên tên cũ (không đổi bản dịch đang dùng); test khẳng định mọi khoá có ở cả vi lẫn en.
export type AppealKind = 'shop' | 'product';

export interface AppealCopyKeys {
  sectionTitle: string;
  sectionDescription: string;
  dialogTitle: string;
  dialogDescription: string;
  messagePlaceholder: string;
  closedHint: string;
  errorNotAllowed: string;
  errorAlreadySent: string;
}

export const APPEAL_COPY_KEYS: Record<AppealKind, AppealCopyKeys> = {
  shop: {
    sectionTitle: 'sectionTitle',
    sectionDescription: 'sectionDescription',
    dialogTitle: 'dialogTitle',
    dialogDescription: 'dialogDescription',
    messagePlaceholder: 'messagePlaceholder',
    closedHint: 'closedHint',
    errorNotAllowed: 'errorNotAllowed',
    errorAlreadySent: 'errorAlreadySent',
  },
  product: {
    sectionTitle: 'productSectionTitle',
    sectionDescription: 'productSectionDescription',
    dialogTitle: 'productDialogTitle',
    dialogDescription: 'productDialogDescription',
    messagePlaceholder: 'productMessagePlaceholder',
    closedHint: 'productClosedHint',
    errorNotAllowed: 'productErrorNotAllowed',
    errorAlreadySent: 'productErrorAlreadySent',
  },
};
