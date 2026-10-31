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

function setup(
  products: ProductListItem[],
  locale: 'vi' | 'en' = 'vi',
  renderProductAppeal?: React.ComponentProps<typeof SellerProductsContainer>['renderProductAppeal'],
) {
  vi.mocked(productService.getMyProducts).mockResolvedValue(products);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    withIntl(
      <QueryClientProvider client={queryClient}>
        <SellerProductsContainer shopId={SHOP} renderProductAppeal={renderProductAppeal} />
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

// Khe cắm kháng nghị (Week11.md 5.8): modules/product không import modules/appeal nên điều khiển kháng nghị do page.tsx truyền vào dạng hàm
// render, và CHỈ được gọi cho sản phẩm bị gỡ.
describe('SellerProductsContainer — khe cắm kháng nghị cho sản phẩm bị gỡ', () => {
  const renderAppeal = (product: { id: string; name: string }) => (
    <span data-testid="appeal-control">{`kháng nghị:${product.id}:${product.name}`}</span>
  );

  it('sản phẩm bị gỡ ⇒ hiện điều khiển kháng nghị của CHÍNH sản phẩm đó, ngay sau nhãn "Bị gỡ"', async () => {
    setup(
      [item({ id: 'p-down', name: 'Dao bấm', status: 'TAKEN_DOWN', takenDownReason: 'x' })],
      'vi',
      renderAppeal,
    );

    const row = await rowOf('Dao bấm');
    const control = within(row).getByTestId('appeal-control');

    expect(control).toHaveTextContent('kháng nghị:p-down:Dao bấm');
    const badge = within(row).getByText('Bị gỡ');
    expect(badge.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Điều khiển nằm cùng cụm với nhãn (cạnh nhãn), không tách ra ngoài dòng.
    expect(control.parentElement).toBe(badge.parentElement);
  });

  it.each(['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const)(
    'sản phẩm %s (không bị gỡ) ⇒ KHÔNG gọi hàm render và không có điều khiển kháng nghị',
    async (status) => {
      const spy = vi.fn(renderAppeal);
      setup([item({ name: 'Áo thun', status })], 'vi', spy);

      const row = await rowOf('Áo thun');

      expect(within(row).queryByTestId('appeal-control')).not.toBeInTheDocument();
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it('chỉ dòng bị gỡ có điều khiển trong danh sách hỗn hợp, mỗi dòng nhận đúng sản phẩm của mình', async () => {
    setup(
      [
        item({ id: 'p-1', name: 'Áo thun', status: 'PUBLISHED' }),
        item({ id: 'p-2', name: 'Dao bấm', status: 'TAKEN_DOWN', takenDownReason: 'x' }),
        item({ id: 'p-3', name: 'Nón', status: 'TAKEN_DOWN', takenDownReason: 'y' }),
      ],
      'vi',
      renderAppeal,
    );

    await rowOf('Áo thun');

    const controls = screen.getAllByTestId('appeal-control').map((el) => el.textContent);
    expect(controls).toEqual(['kháng nghị:p-2:Dao bấm', 'kháng nghị:p-3:Nón']);
  });

  // jsdom không có bố cục nên chỉ khoá cặp lớp; việc đo thật ở 390px làm bằng Playwright (Week11.md 5.8: nút "Kháng nghị" thêm vào cụm nút làm dòng
  // có tên sản phẩm dài tràn ngang 28px nếu cụm không được phép xuống dòng).
  it('dưới `sm` dòng và cụm nút được phép xuống dòng (không tràn ngang ở 390px); từ `sm` giữ nguyên một hàng', async () => {
    setup(
      [item({ id: 'p-down', name: 'Dao bấm', status: 'TAKEN_DOWN', takenDownReason: 'x' })],
      'vi',
      renderAppeal,
    );

    const row = await rowOf('Dao bấm');
    const cluster = within(row).getByTestId('appeal-control').parentElement as HTMLElement;

    expect(row).toHaveClass('max-sm:flex-wrap');
    expect(cluster).toHaveClass('max-sm:flex-wrap');
    // Cụm nút chỉ KHÔNG co từ `sm` trở lên; dưới `sm` phải co về bề rộng dòng thì `flex-wrap` mới có tác dụng.
    expect(cluster).toHaveClass('sm:shrink-0', 'max-sm:max-w-full');
    expect(cluster.className.split(/\s+/)).not.toContain('shrink-0');
    // Không có `flex-wrap` trần: desktop không được đổi (cụm nút luôn nằm bên phải, không rơi xuống dòng dưới).
    expect(row.className.split(/\s+/)).not.toContain('flex-wrap');
    expect(cluster.className.split(/\s+/)).not.toContain('flex-wrap');
  });

  it('không truyền hàm render (như trước đây) ⇒ dòng bị gỡ vẫn chỉ có một đường "Xem lý do"', async () => {
    setup([item({ id: 'p-down', name: 'Dao bấm', status: 'TAKEN_DOWN', takenDownReason: 'x' })]);

    const row = await rowOf('Dao bấm');

    expect(row.querySelectorAll('a, button')).toHaveLength(1);
  });
});
