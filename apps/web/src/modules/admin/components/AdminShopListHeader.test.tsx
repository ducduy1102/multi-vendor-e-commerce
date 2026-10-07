import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { ShopStatus } from '../types';
import { AdminShopListHeader } from './AdminShopListHeader';

describe('AdminShopListHeader', () => {
  it.each<[ShopStatus, string]>([
    ['PENDING', 'Chờ từ'],
    ['APPROVED', 'Duyệt lúc'],
    ['REJECTED', 'Từ chối lúc'],
    ['SUSPENDED', 'Khoá lúc'],
  ])(
    'tab %s: cột ngày có nhãn "%s" — nói đúng sự kiện mà mốc thời gian đại diện',
    (status, label) => {
      render(withIntl(<AdminShopListHeader status={status} />));

      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );

  it('không còn nhãn "Ngày tạo" (cột ngày hiện mốc VÀO trạng thái, không phải ngày tạo shop)', () => {
    render(withIntl(<AdminShopListHeader status="PENDING" />));

    expect(screen.queryByText('Ngày tạo')).not.toBeInTheDocument();
  });

  it('đủ 5 cột và aria-hidden (mỗi ô của dòng dữ liệu đã có nhãn riêng cho trình đọc màn hình)', () => {
    const { container } = render(withIntl(<AdminShopListHeader status="PENDING" />));

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild?.children).toHaveLength(5);
    for (const label of ['Shop', 'Chủ shop', 'Trạng thái', 'Thao tác']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
