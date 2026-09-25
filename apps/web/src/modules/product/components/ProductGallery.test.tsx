import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import { ProductGallery } from './ProductGallery';
import { VariantSelectionProvider } from './VariantSelectionContext';
import { VariantSelector } from './VariantSelector';
import type { SelectorAttribute, SelectorVariant } from './VariantSelector.utils';

function variant(
  id: string,
  attributeValues: { attributeName: string; value: string }[],
  images: { url: string; position: number }[] = [],
  overrides: Partial<SelectorVariant> = {},
): SelectorVariant {
  return {
    id,
    sku: id,
    price: '100000',
    stock: 10,
    isActive: true,
    images,
    weightGram: null,
    attributeValues,
    ...overrides,
  };
}

function attribute(id: string, name: string, values: string[]): SelectorAttribute {
  return {
    id,
    name,
    position: 0,
    values: values.map((value) => ({ id: `${id}-${value}`, value })),
  };
}

// Query bằng CSS: ảnh chính luôn là <img> đầu tiên nằm trong khối vuông
// aspect-square (khác thumbnail, nằm trong <button> và có alt="").
function getMainImageSrc(container: HTMLElement): string | null {
  return container.querySelector('.aspect-square img')?.getAttribute('src') ?? null;
}

describe('ProductGallery', () => {
  it('chưa chọn gì -> hiện ảnh của variant active đầu tiên', () => {
    const variants = [
      variant('v-1', [], [{ url: 'https://img/v1-a.jpg', position: 0 }]),
      variant('v-2', [], [{ url: 'https://img/v2-a.jpg', position: 0 }]),
    ];

    const { container } = render(
      withIntl(
        <VariantSelectionProvider>
          <ProductGallery variants={variants} productName="Áo thun" />
        </VariantSelectionProvider>,
      ),
    );

    expect(getMainImageSrc(container)).toContain('v1-a.jpg');
  });

  it('mảng images rỗng -> hiện placeholder, không vỡ layout (không có <img>)', () => {
    const variants = [variant('v-1', [], [])];

    const { container } = render(
      withIntl(
        <VariantSelectionProvider>
          <ProductGallery variants={variants} productName="Áo thun" />
        </VariantSelectionProvider>,
      ),
    );

    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('đổi cả bộ ảnh khi chọn variant khác (chỉ cần chọn 1 phần thuộc tính, chưa cần đủ combo)', async () => {
    const attributes: SelectorAttribute[] = [attribute('attr-color', 'Màu sắc', ['Đỏ', 'Xanh'])];
    const variants = [
      variant(
        'v-do',
        [{ attributeName: 'Màu sắc', value: 'Đỏ' }],
        [
          { url: 'https://img/do-1.jpg', position: 0 },
          { url: 'https://img/do-2.jpg', position: 1 },
        ],
      ),
      variant(
        'v-xanh',
        [{ attributeName: 'Màu sắc', value: 'Xanh' }],
        [{ url: 'https://img/xanh-1.jpg', position: 0 }],
      ),
    ];

    const user = userEvent.setup();
    const { container } = render(
      withIntl(
        <VariantSelectionProvider>
          <VariantSelector attributes={attributes} variants={variants} />
          <ProductGallery variants={variants} productName="Áo thun" />
        </VariantSelectionProvider>,
      ),
    );

    // Mặc định: ảnh của v-do (variant active đầu tiên) — có 2 ảnh nên có
    // thêm hàng thumbnail.
    expect(getMainImageSrc(container)).toContain('do-1.jpg');
    expect(screen.getByRole('button', { name: 'Ảnh 2' })).toBeInTheDocument();

    // Đổi màu -> ảnh chính nhảy sang ảnh của v-xanh, dải thumbnail vẫn đủ
    // ảnh của cả sản phẩm (do-1, do-2, xanh-1), không thu lại theo variant.
    await user.click(screen.getByRole('button', { name: 'Xanh' }));
    expect(getMainImageSrc(container)).toContain('xanh-1.jpg');
    expect(screen.getByRole('button', { name: 'Ảnh 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ảnh 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ảnh 3' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('bấm thumbnail để đổi ảnh chính trong cùng 1 variant', async () => {
    const variants = [
      variant(
        'v-1',
        [],
        [
          { url: 'https://img/a.jpg', position: 0 },
          { url: 'https://img/b.jpg', position: 1 },
        ],
      ),
    ];

    const user = userEvent.setup();
    const { container } = render(
      withIntl(
        <VariantSelectionProvider>
          <ProductGallery variants={variants} productName="Áo thun" />
        </VariantSelectionProvider>,
      ),
    );

    expect(getMainImageSrc(container)).toContain('a.jpg');

    await user.click(screen.getByRole('button', { name: 'Ảnh 2' }));
    expect(getMainImageSrc(container)).toContain('b.jpg');
  });

  it('đổi variant thì quay về ảnh đầu tiên, không giữ index thumbnail cũ', async () => {
    const attributes: SelectorAttribute[] = [attribute('attr-color', 'Màu sắc', ['Đỏ', 'Xanh'])];
    const variants = [
      variant(
        'v-do',
        [{ attributeName: 'Màu sắc', value: 'Đỏ' }],
        [
          { url: 'https://img/do-1.jpg', position: 0 },
          { url: 'https://img/do-2.jpg', position: 1 },
        ],
      ),
      variant(
        'v-xanh',
        [{ attributeName: 'Màu sắc', value: 'Xanh' }],
        [
          { url: 'https://img/xanh-1.jpg', position: 0 },
          { url: 'https://img/xanh-2.jpg', position: 1 },
        ],
      ),
    ];

    const user = userEvent.setup();
    const { container } = render(
      withIntl(
        <VariantSelectionProvider>
          <VariantSelector attributes={attributes} variants={variants} />
          <ProductGallery variants={variants} productName="Áo thun" />
        </VariantSelectionProvider>,
      ),
    );

    // Bấm thumbnail thứ 2 của v-do trước.
    await user.click(screen.getByRole('button', { name: 'Ảnh 2' }));
    expect(getMainImageSrc(container)).toContain('do-2.jpg');

    // Đổi sang Xanh -> phải về ảnh ĐẦU TIÊN của bộ mới (xanh-1), không phải
    // giữ index 1 cũ (sẽ ra xanh-2 nếu còn giữ index cũ — sai).
    await user.click(screen.getByRole('button', { name: 'Xanh' }));
    expect(getMainImageSrc(container)).toContain('xanh-1.jpg');
  });

  it('thumbnail gộp ảnh mọi variant, bỏ trùng URL, bấm thumbnail của variant khác vẫn hiện được', async () => {
    const variants = [
      variant(
        'v-do',
        [{ attributeName: 'Màu sắc', value: 'Đỏ' }],
        [
          { url: 'https://img/do-1.jpg', position: 0 },
          { url: 'https://img/chung.jpg', position: 1 },
        ],
      ),
      variant(
        'v-xanh',
        [{ attributeName: 'Màu sắc', value: 'Xanh' }],
        [
          { url: 'https://img/chung.jpg', position: 0 },
          { url: 'https://img/xanh-2.jpg', position: 1 },
        ],
      ),
    ];

    const user = userEvent.setup();
    const { container } = render(
      withIntl(
        <VariantSelectionProvider>
          <ProductGallery variants={variants} productName="Áo thun" />
        </VariantSelectionProvider>,
      ),
    );

    // 3 thumbnail (chung.jpg chỉ xuất hiện 1 lần), không có "Ảnh 4".
    expect(screen.getByRole('button', { name: 'Ảnh 3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ảnh 4' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ảnh 3' }));
    expect(getMainImageSrc(container)).toContain('xanh-2.jpg');
  });
});
