import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import { ProductFilterBar } from './ProductFilterBar';

const push = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
}));

// Slider của khoảng giá cần layout thật (jsdom không có) và đã có kiểm riêng — ở đây chỉ kiểm phần sắp xếp.
vi.mock('./PriceRangeFilter', () => ({
  PriceRangeFilter: () => null,
}));

function renderBar(initialFilters: Parameters<typeof ProductFilterBar>[0]['initialFilters']) {
  return render(withIntl(<ProductFilterBar categories={[]} initialFilters={initialFilters} />));
}

describe('ProductFilterBar — sắp xếp', () => {
  beforeEach(() => {
    push.mockReset();
  });

  it('có đủ 4 cách sắp xếp, gồm "Đánh giá cao nhất" (rating)', () => {
    renderBar({ sort: 'newest' });

    const select = screen.getByLabelText('Sắp xếp');
    const options = within(select).getAllByRole('option');
    expect(options.map((option) => [option.getAttribute('value'), option.textContent])).toEqual([
      ['newest', 'Mới nhất'],
      ['price-asc', 'Giá tăng dần'],
      ['price-desc', 'Giá giảm dần'],
      ['rating', 'Đánh giá cao nhất'],
    ]);
  });

  it('chọn "Đánh giá cao nhất" -> đẩy ?sort=rating lên URL, giữ bộ lọc khác và bỏ trang', async () => {
    const user = userEvent.setup();
    renderBar({ q: 'áo', categoryId: 'cat-1', sort: 'newest' });

    await user.selectOptions(screen.getByLabelText('Sắp xếp'), 'rating');

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({
      pathname: '/products',
      query: { q: 'áo', categoryId: 'cat-1', sort: 'rating' },
    });
  });

  it('đang sắp theo rating thì ô chọn hiện đúng giá trị, đổi lại "Mới nhất" thì URL mang sort=newest', async () => {
    const user = userEvent.setup();
    renderBar({ sort: 'rating' });

    const select = screen.getByLabelText('Sắp xếp') as HTMLSelectElement;
    expect(select.value).toBe('rating');

    await user.selectOptions(select, 'newest');

    expect(push).toHaveBeenCalledWith({ pathname: '/products', query: { sort: 'newest' } });
  });
});
