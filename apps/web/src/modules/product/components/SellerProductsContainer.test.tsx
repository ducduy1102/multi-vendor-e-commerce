import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import * as productService from '../services/product.service';
import type { ProductListItem } from '../types';
import { SellerProductsContainer } from './SellerProductsContainer';

// Dòng của danh sách sản phẩm theo từng trạng thái (Week11.md 5.7): sản phẩm bị sàn gỡ hiện nhãn "Bị gỡ" + lý do và KHÔNG có nút lưu
// trữ / mở lại (BE từ chối 409); các trạng thái khác giữ nguyên nút cũ. Luồng lưu trữ / mở lại do useUpdateProductStatus.test.tsx kiểm.
vi.mock('../services/product.service', () => ({
  getMyProducts: vi.fn(),
  archiveProduct: vi.fn(),
  updateProduct: vi.fn(),
}));

const SHOP = 'shop-1';

function item(overrides: Partial<ProductListItem>): ProductListItem {
  return {
    id: 'product-1',
    categoryId: 'cat-1',
    name: 'Áo thun',
    slug: 'ao-thun',
    status: 'DRAFT',
    takenDownReason: null,
    minPrice: '100000',
    maxPrice: '100000',
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
    variants: [],
    ...overrides,
  };
}

function setup(products: ProductListItem[], locale: 'vi' | 'en' = 'vi') {
  vi.mocked(productService.getMyProducts).mockResolvedValue(products);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    withIntl(
      <QueryClientProvider client={queryClient}>
        <SellerProductsContainer shopId={SHOP} />
      </QueryClientProvider>,
      locale,
    ),
  );
}

const anchorOf = (row: HTMLElement, name: string) => within(row).getByText(name).closest('a');

const rowOf = async (name: string) => {
  const title = await screen.findByText(name);
  return title.closest('li') as HTMLElement;
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('SellerProductsContainer — sản phẩm bị sàn gỡ', () => {
  const reason = 'Bán hàng cấm: dao bấm tự động lò xo.';

  it('hiện nhãn "Bị gỡ" và LÝ DO từ sàn ngay dưới tên sản phẩm', async () => {
    setup([item({ id: 'p-down', name: 'Dao bấm', status: 'TAKEN_DOWN', takenDownReason: reason })]);

    const row = await rowOf('Dao bấm');

    expect(within(row).getByText('Bị gỡ')).toBeInTheDocument();
    expect(within(row).getByText(`Lý do từ sàn: ${reason}`)).toBeInTheDocument();
  });

  it('KHÔNG có nút Lưu trữ / Mở lại; chỉ một đường "Xem lý do" tới trang của sản phẩm (không còn "Sửa")', async () => {
    setup([item({ id: 'p-down', name: 'Dao bấm', status: 'TAKEN_DOWN', takenDownReason: reason })]);

    const row = await rowOf('Dao bấm');

    expect(within(row).queryByRole('button', { name: 'Lưu trữ' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Mở lại' })).not.toBeInTheDocument();
    expect(anchorOf(row, 'Xem lý do')).toHaveAttribute('href', '/seller/products/p-down/edit');
    expect(within(row).queryByText('Sửa')).not.toBeInTheDocument();
    expect(row.querySelectorAll('a, button')).toHaveLength(1);
  });

  it('lý do dài: bẻ chuỗi không dấu cách, kẹp 2 dòng và mang bản đầy đủ ở title', async () => {
    const long = 'x'.repeat(400);
    setup([item({ name: 'Dao bấm', status: 'TAKEN_DOWN', takenDownReason: long })]);

    const row = await rowOf('Dao bấm');
    const line = within(row).getByText(`Lý do từ sàn: ${long}`);

    expect(line.className).toContain('[overflow-wrap:anywhere]');
    expect(line.className).toContain('line-clamp-2');
    expect(line).toHaveAttribute('title', long);
  });

  it('không có lý do (dữ liệu lệch) ⇒ vẫn hiện nhãn, không in dòng lý do rỗng', async () => {
    setup([item({ name: 'Dao bấm', status: 'TAKEN_DOWN', takenDownReason: null })]);

    const row = await rowOf('Dao bấm');

    expect(within(row).getByText('Bị gỡ')).toBeInTheDocument();
    expect(within(row).queryByText(/Lý do từ sàn/)).not.toBeInTheDocument();
  });

  it('trạng thái khác mà còn sót lý do (dữ liệu lệch) ⇒ KHÔNG in dòng lý do từ sàn', async () => {
    setup([item({ name: 'Nháp lệch', status: 'DRAFT', takenDownReason: 'còn sót' })]);

    const row = await rowOf('Nháp lệch');

    expect(within(row).queryByText(/Lý do từ sàn/)).not.toBeInTheDocument();
  });

  it('nhãn mang tông đỏ (destructive) để phân biệt với "Đã lưu trữ"', async () => {
    setup([
      item({ id: 'a', name: 'Bị gỡ A', status: 'TAKEN_DOWN', takenDownReason: reason }),
      item({ id: 'b', name: 'Lưu trữ B', status: 'ARCHIVED' }),
    ]);

    const down = within(await rowOf('Bị gỡ A')).getByText('Bị gỡ');
    const archived = within(await rowOf('Lưu trữ B')).getByText('Đã lưu trữ');

    expect(down.className).toContain('text-destructive');
    expect(archived.className).not.toContain('text-destructive');
  });

  it('các trạng thái khác giữ nguyên nút: nháp / đang bán có "Sửa" + "Lưu trữ", đã lưu trữ có "Mở lại"; không có lý do từ sàn', async () => {
    setup([
      item({ id: 'a', name: 'Nháp A', status: 'DRAFT' }),
      item({ id: 'b', name: 'Bán B', status: 'PUBLISHED' }),
      item({ id: 'c', name: 'Lưu trữ C', status: 'ARCHIVED' }),
    ]);

    for (const name of ['Nháp A', 'Bán B']) {
      const row = await rowOf(name);
      expect(anchorOf(row, 'Sửa')).toHaveAttribute('href');
      expect(within(row).getByRole('button', { name: 'Lưu trữ' })).toBeInTheDocument();
    }
    const archivedRow = await rowOf('Lưu trữ C');
    expect(within(archivedRow).getByRole('button', { name: 'Mở lại' })).toBeInTheDocument();
    expect(screen.queryByText(/Lý do từ sàn/)).not.toBeInTheDocument();
  });

  it('có bản tiếng Anh: nhãn, lý do và link', async () => {
    setup(
      [item({ name: 'Knife', status: 'TAKEN_DOWN', takenDownReason: 'Prohibited item.' })],
      'en',
    );

    const row = await rowOf('Knife');

    expect(within(row).getByText('Taken down')).toBeInTheDocument();
    expect(
      within(row).getByText('Reason from the marketplace: Prohibited item.'),
    ).toBeInTheDocument();
    expect(anchorOf(row, 'See reason')).toHaveAttribute('href');
  });
});
