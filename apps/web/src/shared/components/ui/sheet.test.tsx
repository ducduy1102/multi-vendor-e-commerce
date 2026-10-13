import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import en from '../../../../messages/en.json';

import { Sheet, SheetContent, SheetTitle } from './sheet';

function renderSheet(showCloseButton?: boolean) {
  return (
    <Sheet open>
      <SheetContent showCloseButton={showCloseButton}>
        <SheetTitle>Tiêu đề</SheetTitle>
      </SheetContent>
    </Sheet>
  );
}

// Nút đóng của primitive từng có chữ "Close" cứng tiếng Anh (bản shadcn sinh ra) nên người dùng đọc màn hình ở
// locale vi nghe tiếng Anh. Đã sửa tay ở primitive; `shadcn add sheet` ghi đè mất thì các test này đỏ để nhắc.
describe('SheetContent', () => {
  it('nút đóng có tên truy cập đã dịch theo locale (vi: "Đóng")', () => {
    render(withIntl(renderSheet()));

    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
    expect(screen.queryByText('Close')).not.toBeInTheDocument();
  });

  it('en: "Close"', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        {renderSheet()}
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('showCloseButton={false} không vẽ nút đóng', () => {
    render(withIntl(renderSheet(false)));

    expect(screen.queryByRole('button', { name: 'Đóng' })).not.toBeInTheDocument();
  });
});
