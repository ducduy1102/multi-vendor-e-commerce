'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Alert } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import { APPEAL_COPY_KEYS, type AppealKind } from '../appeal-copy';
import { useDescribeAppealError } from '../hooks/useDescribeAppealError';
import type { ShopAppealsResponse } from '../types';
import { APPEAL_SECTION_CLASS } from './appeal-section.constants';
import { AppealCard } from './AppealCard';
import { AppealDialog } from './AppealDialog';
import { ShopAppealSectionSkeleton } from './ShopAppealSectionSkeleton';

interface AppealSectionProps {
  kind: AppealKind;
  // Chỉ phần của kết quả `useQuery` mà mục này cần — để cả kháng nghị shop lẫn kháng nghị sản phẩm truyền hook của mình vào.
  appealsQuery: {
    data: ShopAppealsResponse | undefined;
    isPending: boolean;
    refetch: () => unknown;
  };
  // Chỉ phần của kết quả `useMutation` mà mục này cần. `mutateAsync` ném lỗi khi gửi thất bại (mục này tự dịch lỗi và hiện trong hộp thoại).
  createAppeal: {
    mutateAsync: (message: string) => Promise<unknown>;
    isPending: boolean;
  };
}

// Mục kháng nghị dùng chung cho shop bị khoá (Week11.md 4.6) và sản phẩm bị gỡ (5.8): nút gửi (chỉ khi SERVER báo `canAppeal`) + lịch sử
// kháng nghị kèm phản hồi từ sàn. Nơi ghép (`app/...`) chỉ dựng mục này khi đối tượng đang bị xử lý — module `appeal` không biết trạng thái
// shop hay sản phẩm (không import `shop`/`product`). Không có gì để hiện (không kháng nghị được và chưa từng kháng nghị — vd shop bị khoá
// theo cascade tài khoản) thì không vẽ gì. Container không cần unit test (rules/frontend.md mục 8) nhưng được test qua hai wrapper mỏng
// (`ShopAppealSection`, `ProductAppealSection`): phần có logic đã tách ra component thuần có test (AppealDialog, AppealCard) và hook có test.
export function AppealSection({ kind, appealsQuery, createAppeal }: AppealSectionProps) {
  const t = useTranslations('appeal');
  const tCopy = t as unknown as LooseTranslator;
  const tCommon = useTranslations('common');
  const headingId = useId();
  const describeError = useDescribeAppealError(kind);
  const copy = APPEAL_COPY_KEYS[kind];
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSent, setIsSent] = useState(false);

  // Có dữ liệu thì luôn hiện dữ liệu — lần tải lại ngầm lỗi (mạng chớp) không được xoá mất lịch sử đang xem.
  const data = appealsQuery.data;

  if (!data) {
    if (appealsQuery.isPending) {
      return (
        <div aria-busy="true">
          <span className="sr-only">{tCommon('loading')}</span>
          <ShopAppealSectionSkeleton />
        </div>
      );
    }
    return (
      <div className={APPEAL_SECTION_CLASS}>
        <p role="alert" className="text-sm text-destructive">
          {t('loadError')}
        </p>
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => void appealsQuery.refetch()}
        >
          {t('retry')}
        </Button>
      </div>
    );
  }

  const { appeals, canAppeal } = data;
  if (appeals.length === 0 && !canAppeal && !isOpen) return null;

  function openDialog() {
    setError(null);
    setIsSent(false);
    setIsOpen(true);
  }

  // Đang gửi thì không cho đóng (Esc/bấm nền) — hộp thoại tự đóng khi gửi xong.
  function handleOpenChange(open: boolean) {
    if (!open && createAppeal.isPending) return;
    setIsOpen(open);
  }

  async function handleSubmit(message: string): Promise<boolean> {
    setError(null);
    try {
      await createAppeal.mutateAsync(message);
    } catch (submitError) {
      setError(describeError(submitError));
      return false;
    }
    setIsOpen(false);
    setIsSent(true);
    return true;
  }

  return (
    <section aria-labelledby={headingId} className={APPEAL_SECTION_CLASS}>
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-base font-semibold text-foreground">
          {tCopy(copy.sectionTitle)}
        </h2>
        {canAppeal ? (
          <p className="text-sm text-muted-foreground">{tCopy(copy.sectionDescription)}</p>
        ) : null}
      </div>

      {isSent ? (
        <Alert variant="success" role="status" className="grid-cols-1">
          {t('sentSuccess')}
        </Alert>
      ) : null}

      {canAppeal ? (
        <Button type="button" className="self-start" onClick={openDialog}>
          {t('openButton')}
        </Button>
      ) : null}

      {appeals.length > 0 ? (
        <ul aria-label={t('historyLabel')} className="flex flex-col gap-2">
          {appeals.map((appeal) => (
            <AppealCard key={appeal.id} appeal={appeal} kind={kind} />
          ))}
        </ul>
      ) : null}

      <AppealDialog
        kind={kind}
        open={isOpen}
        onOpenChange={handleOpenChange}
        isPending={createAppeal.isPending}
        error={error}
        onSubmit={handleSubmit}
      />
    </section>
  );
}
