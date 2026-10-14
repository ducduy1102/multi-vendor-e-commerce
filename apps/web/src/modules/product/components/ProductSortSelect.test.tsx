import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ProductSortSelect } from './ProductSortSelect';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
}));

describe('ProductSortSelect', () => {
  beforeEach(() => {
    push.mockReset();
  });

  it('có đúng 4 lựa chọn và chọn sẵn giá trị hiện tại', () => {
    render(withIntl(<ProductSortSelect value="price-asc" basePath="/shops/my-shop" />));

    const select = screen.getByLabelText('Sắp xếp') as HTMLSelectElement;
    expect(select.value).toBe('price-asc');
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      'newest',
      'price-asc',
      'price-desc',
      'rating',
    ]);
  });

  it('đổi sắp xếp -> điều hướng về path hiện tại kèm ?sort=, không giữ page (về trang 1)', async () => {
    const user = userEvent.setup();
    render(withIntl(<ProductSortSelect value="newest" basePath="/shops/my-shop" />));

    await user.selectOptions(screen.getByLabelText('Sắp xếp'), 'rating');

    expect(push).toHaveBeenCalledWith('/shops/my-shop?sort=rating');
  });

  it('chọn "Mới nhất" (mặc định) -> URL gọn, không có ?sort=', async () => {
    const user = userEvent.setup();
    render(withIntl(<ProductSortSelect value="price-desc" basePath="/shops/my-shop" />));

    await user.selectOptions(screen.getByLabelText('Sắp xếp'), 'newest');

    expect(push).toHaveBeenCalledWith('/shops/my-shop');
  });
});
