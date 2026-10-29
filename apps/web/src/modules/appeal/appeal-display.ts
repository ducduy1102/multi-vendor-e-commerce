import type { AppealState } from './types';

// Sắc thái huy hiệu — chỉ token ngữ nghĩa (rules/frontend.md "UI polish" mục 2), accent (cam) không dùng cho trạng thái.
export type AppealBadgeTone = 'warning' | 'success' | 'destructive' | 'muted';

// Cách hiển thị MỘT trạng thái kháng nghị cho chủ shop: key i18n (namespace `appeal`) + sắc thái. `PENDING` là việc đang chờ
// người khác (warning), được chấp nhận là tin tốt, bị từ chối là tin xấu (destructive), `CLOSED` trung tính (lần khoá đã kết thúc
// nên kháng nghị không còn ý nghĩa). Test kiểm mọi key đều có bản dịch vi + en.
export const APPEAL_STATE_DISPLAY: Record<
  AppealState,
  { labelKey: string; tone: AppealBadgeTone }
> = {
  PENDING: { labelKey: 'statePending', tone: 'warning' },
  ACCEPTED: { labelKey: 'stateAccepted', tone: 'success' },
  REJECTED: { labelKey: 'stateRejected', tone: 'destructive' },
  CLOSED: { labelKey: 'stateClosed', tone: 'muted' },
};

// Lớp của huy hiệu theo sắc thái. Chữ của `warning` dùng foreground (amber làm màu chữ không đủ tương phản ở cỡ 12px); nền hồng
// nhạt của variant `destructive` chỉ đạt 3,97:1 ở chế độ sáng nên dùng nền trắng + viền đỏ nhạt như huy hiệu của khu Admin.
export const APPEAL_BADGE_CLASS: Record<
  AppealBadgeTone,
  { variant: 'outline' | 'destructive'; className: string }
> = {
  warning: { variant: 'outline', className: 'border-warning/40 bg-warning/15 text-foreground' },
  success: { variant: 'outline', className: 'border-success/30 bg-success/10 text-success' },
  destructive: {
    variant: 'destructive',
    className: 'border-destructive/30 bg-background dark:border-transparent',
  },
  muted: { variant: 'outline', className: 'text-muted-foreground' },
};
