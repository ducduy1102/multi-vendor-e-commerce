import { cn } from '@/shared/lib/utils';

export interface TimelineStepItem {
  // Khoá ổn định của bước trong danh sách (không dùng chỉ số mảng).
  id: string;
  // Dòng mô tả bước, ĐÃ dịch bởi nơi gọi.
  label: string;
  // Thời điểm gốc (ISO) cho `<time dateTime>` và bản đã định dạng để hiển thị.
  createdAt: string;
  formattedDate: string;
  // Câu ghi chú đã dịch kèm lý do (vd "Lý do của shop: Hết hàng"); không có thì không render dòng này.
  note?: string | null;
}

interface TimelineStepsProps {
  // Thứ tự HIỂN THỊ: bước mới nhất ở đầu (nơi gọi tự sắp). Mảng rỗng thì không render gì.
  steps: readonly TimelineStepItem[];
}

// Khung dòng thời gian dùng chung cho lịch sử ĐƠN (OrderTimeline) và lịch sử YÊU CẦU hủy/trả hàng
// (RefundRequestCard): chỉ lo hiển thị — chấm + đường nối, bước mới nhất nhấn mạnh (chấm primary, chữ đậm,
// `aria-current="step"`), `<time>` mang thời điểm gốc. Việc dịch nhãn, định dạng ngày và quyết định có hiện ghi
// chú hay không thuộc nơi gọi (mỗi bên có luật riêng), nên component này không gọi hook i18n nào. Ghi chú là chữ
// shop/sàn/người mua nhập nên `break-words` + `whitespace-pre-line`, cột `min-w-0` để chuỗi dài không đẩy rộng
// trang (rules/frontend.md mục 5).
export function TimelineSteps({ steps }: TimelineStepsProps) {
  if (steps.length === 0) {
    return null;
  }

  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => {
        const isCurrent = index === 0;
        const isLast = index === steps.length - 1;

        return (
          <li
            key={step.id}
            aria-current={isCurrent ? 'step' : undefined}
            className="relative flex gap-3 pb-4 last:pb-0"
          >
            {isLast ? null : (
              <span
                aria-hidden="true"
                className="absolute top-3 bottom-0 left-[5px] w-px bg-border"
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                'relative mt-1 size-[11px] shrink-0 rounded-full border-2',
                isCurrent ? 'border-primary bg-primary' : 'border-border bg-background',
              )}
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span
                className={cn(
                  'text-sm',
                  isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
              <time dateTime={step.createdAt} className="text-xs text-muted-foreground">
                {step.formattedDate}
              </time>
              {step.note ? (
                <span className="text-sm break-words whitespace-pre-line text-foreground">
                  {step.note}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
