import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import { VariantSelectionProvider } from './VariantSelectionContext';
import { VariantSelector } from './VariantSelector';
import type { SelectorAttribute, SelectorVariant } from './VariantSelector.utils';

function variant(
  id: string,
  attributeValues: { attributeName: string; value: string }[],
  overrides: Partial<SelectorVariant> = {},
): SelectorVariant {
  return {
    id,
    sku: id,
    price: '100000',
    stock: 10,
    isActive: true,
    images: [],
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

const attributes: SelectorAttribute[] = [
  attribute('attr-color', 'Màu sắc', ['Đỏ', 'Xanh']),
  attribute('attr-size', 'Size', ['M', 'L']),
];

const variants: SelectorVariant[] = [
  variant('v-do-m', [
    { attributeName: 'Màu sắc', value: 'Đỏ' },
    { attributeName: 'Size', value: 'M' },
  ]),
  variant(
    'v-do-l',
    [
      { attributeName: 'Màu sắc', value: 'Đỏ' },
      { attributeName: 'Size', value: 'L' },
    ],
    { stock: 0 },
  ),
  variant('v-xanh-m', [
    { attributeName: 'Màu sắc', value: 'Xanh' },
    { attributeName: 'Size', value: 'M' },
  ]),
  variant('v-xanh-l', [
    { attributeName: 'Màu sắc', value: 'Xanh' },
    { attributeName: 'Size', value: 'L' },
  ]),
];

function renderSelector(attrs: SelectorAttribute[], vars: SelectorVariant[]) {
  return render(
    withIntl(
      <VariantSelectionProvider>
        <VariantSelector attributes={attrs} variants={vars} />
      </VariantSelectionProvider>,
    ),
  );
}

describe('VariantSelector', () => {
  it('không render gì khi sản phẩm không có attribute (chỉ variant mặc định)', () => {
    const { container } = renderSelector([], [variant('v-default', [])]);

    expect(container).toBeEmptyDOMElement();
  });

  it('render đủ mọi attribute + giá trị', () => {
    renderSelector(attributes, variants);

    expect(screen.getByText('Màu sắc')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đỏ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xanh' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'M' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'L' })).toBeInTheDocument();
  });

  it('bấm 1 giá trị -> chuyển sang trạng thái đã chọn (aria-pressed)', async () => {
    const user = userEvent.setup();
    renderSelector(attributes, variants);

    const doButton = screen.getByRole('button', { name: 'Đỏ' });
    expect(doButton).toHaveAttribute('aria-pressed', 'false');

    await user.click(doButton);
    expect(doButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('bấm lại giá trị đang chọn để bỏ chọn (toggle off)', async () => {
    const user = userEvent.setup();
    renderSelector(attributes, variants);

    const doButton = screen.getByRole('button', { name: 'Đỏ' });
    await user.click(doButton);
    expect(doButton).toHaveAttribute('aria-pressed', 'true');

    await user.click(doButton);
    expect(doButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('disable đúng option hết hàng theo combo đã chọn, không disable cả sản phẩm', async () => {
    const user = userEvent.setup();
    renderSelector(attributes, variants);

    // Chưa chọn gì: mọi giá trị đều còn ít nhất 1 combo còn hàng -> không disable.
    expect(screen.getByRole('button', { name: 'Đỏ' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'L' })).toBeEnabled();

    // Chọn Size=L trước -> Đỏ dẫn tới v-do-l (stock=0) -> Đỏ phải disable
    // (aria-label đổi thành "Đỏ — Hết hàng" nên phải match bằng regex thay
    // vì tên chính xác "Đỏ"), Xanh vẫn còn hàng (v-xanh-l) -> vẫn enabled.
    await user.click(screen.getByRole('button', { name: 'L' }));
    expect(screen.getByRole('button', { name: /Đỏ/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xanh' })).toBeEnabled();
  });

  it('không cho chọn giá trị đang disabled (click không có tác dụng, vẫn ở trạng thái chưa chọn)', async () => {
    const user = userEvent.setup();
    renderSelector(attributes, variants);

    await user.click(screen.getByRole('button', { name: 'L' }));

    const doButton = screen.getByRole('button', { name: /Đỏ/ });
    await user.click(doButton); // đang disabled — button native tự chặn click
    expect(doButton).toHaveAttribute('aria-pressed', 'false');
  });
});
