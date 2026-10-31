'use client';

import { useTranslations } from 'next-intl';

import { StarRating } from '@/shared/components/StarRating';
import { cn } from '@/shared/lib/utils';

import type { AdminReport } from '../types';

interface AdminReportSnapshotProps {
  report: AdminReport;
  // Rút gọn nội dung dài (danh sách / khung xem nhanh); trang chi tiết đọc đủ.
  isClamped?: boolean;
  className?: string;
}

// Ảnh chụp đối tượng bị báo LÚC BÁO (đối tượng có thể bị sửa sau đó). Mọi chữ do người dùng nhập (tên, nội dung đánh giá) là văn bản
// tự do: `[overflow-wrap:anywhere]` để chuỗi dài không dấu cách không đẩy rộng khung (rules/frontend.md mục 5). Hội thoại tuyệt đối không
// có nội dung tin nhắn — chỉ tên hai bên và vai người báo.
export function AdminReportSnapshot({
  report,
  isClamped = false,
  className,
}: AdminReportSnapshotProps) {
  const t = useTranslations('admin');
  const clamp = isClamped ? 'line-clamp-4' : undefined;

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5 rounded-lg bg-muted/40 p-3', className)}>
      {report.targetType === 'REVIEW' ? (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StarRating value={report.snapshot.rating} size="sm" />
            <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
              {report.snapshot.authorName}
            </span>
          </div>
          {report.snapshot.comment ? (
            <p
              className={cn(
                'text-sm text-pretty whitespace-pre-line [overflow-wrap:anywhere]',
                clamp,
              )}
            >
              {report.snapshot.comment}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('reportsSnapshotNoComment')}</p>
          )}
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {t('reportsSnapshotProduct', { name: report.snapshot.productName })}
          </p>
        </>
      ) : null}
      {report.targetType === 'SHOP' ? (
        <>
          <p className="text-sm font-medium [overflow-wrap:anywhere]">{report.snapshot.name}</p>
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            /shops/{report.snapshot.slug}
          </p>
        </>
      ) : null}
      {report.targetType === 'PRODUCT' ? (
        <>
          <p className="text-sm font-medium [overflow-wrap:anywhere]">{report.snapshot.name}</p>
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {t('reportsProductShop', { name: report.snapshot.shopName })}
          </p>
        </>
      ) : null}
      {report.targetType === 'CONVERSATION' ? (
        <>
          <p className="text-sm font-medium [overflow-wrap:anywhere]">
            {report.snapshot.buyerName} ↔ {report.snapshot.shopName}
          </p>
          <p className="text-xs text-pretty text-muted-foreground">
            {t('reportsConversationExcerpt', {
              role:
                report.snapshot.reporterRole === 'SHOP'
                  ? t('reportsRoleShop')
                  : t('reportsRoleBuyer'),
            })}
          </p>
        </>
      ) : null}
    </div>
  );
}
