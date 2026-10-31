import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import * as productService from '../services/product.service';
import type { Product } from '../types';
import { EditProductFormContainer } from './EditProductFormContainer';

// Hành vi duy nhất của container này đáng khoá bằng test là CỔNG theo trạng thái (Week11.md 5.7): sản phẩm bị sàn gỡ thì KHÔNG dựng form
// (không có nút nào để bấm rồi mới bị BE từ chối 409), mọi trạng thái khác dựng form như cũ. Luồng điều hướng sau khi lưu do Playwright kiểm.
vi.mock('@/i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/navigation')>()),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../services/product.service', () => ({
  getProduct: vi.fn(),
  getCategories: vi.fn(),
  updateProduct: vi.fn(),
}));

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    shopId: 'shop-1',
    categoryId: 'cat-1',
    name: 'Dao bấm tự động',
    slug: 'dao-bam-tu-dong',
    description: null,
    status: 'DRAFT',
    takenDownReason: null,
    minPrice: '100000',
    maxPrice: '100000',
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
    attributes: [],
    variants: [],
    ...overrides,
  };
}

function setup(product: Product, appealSlot?: React.ReactNode) {
  vi.mocked(productService.getProduct).mockResolvedValue(product);
  vi.mocked(productService.getCategories).mockResolvedValue([
    { id: 'cat-1', name: 'Gia dụng', slug: 'gia-dung', parentId: null },
  ]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    withIntl(
      <QueryClientProvider client={queryClient}>
        <EditProductFormContainer productId={product.id} appealSlot={appealSlot} />
      </QueryClientProvider>,
    ),
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('EditProductFormContainer — cổng theo trạng thái', () => {
  it('sản phẩm bị sàn gỡ ⇒ thông báo kèm lý do, KHÔNG có form sửa', async () => {
    setup(makeProduct({ status: 'TAKEN_DOWN', takenDownReason: 'Bán hàng cấm theo quy định.' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sản phẩm này đã bị sàn gỡ');
    expect(screen.getByText('Lý do từ sàn: Bán hàng cấm theo quy định.')).toBeInTheDocument();
    expect(screen.getByText('Dao bấm tự động')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tên sản phẩm')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Lưu|Cập nhật/ })).not.toBeInTheDocument();
  });

  it.each(['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const)(
    'sản phẩm %s ⇒ dựng form sửa như cũ, không có thông báo bị gỡ',
    async (status) => {
      setup(makeProduct({ status }));

      expect(await screen.findByLabelText('Tên sản phẩm')).toHaveValue('Dao bấm tự động');
      expect(screen.queryByText('Sản phẩm này đã bị sàn gỡ')).not.toBeInTheDocument();
    },
  );
});

// Khe cắm kháng nghị (Week11.md 5.8): chỉ hiện trong nhánh "sản phẩm bị gỡ"; modules/product không import modules/appeal.
describe('EditProductFormContainer — khe cắm kháng nghị', () => {
  const slot = <div data-testid="appeal-slot">mục kháng nghị</div>;

  it('sản phẩm bị gỡ ⇒ hiện mục kháng nghị dưới thông báo, trước đường về danh sách', async () => {
    setup(makeProduct({ status: 'TAKEN_DOWN', takenDownReason: 'Bán hàng cấm.' }), slot);

    const alert = await screen.findByRole('alert');
    const appeal = screen.getByTestId('appeal-slot');
    const back = screen.getByRole('link', { name: 'Về danh sách sản phẩm' });

    expect(alert.compareDocumentPosition(appeal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(appeal.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const)(
    'sản phẩm %s ⇒ KHÔNG hiện mục kháng nghị (chỉ sản phẩm đang bị gỡ mới có gì để kháng nghị)',
    async (status) => {
      setup(makeProduct({ status }), slot);

      await screen.findByLabelText('Tên sản phẩm');

      expect(screen.queryByTestId('appeal-slot')).not.toBeInTheDocument();
    },
  );

  it('không truyền khe cắm ⇒ thông báo bị gỡ như cũ', async () => {
    setup(makeProduct({ status: 'TAKEN_DOWN', takenDownReason: 'Bán hàng cấm.' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sản phẩm này đã bị sàn gỡ');
    expect(screen.queryByTestId('appeal-slot')).not.toBeInTheDocument();
  });
});
