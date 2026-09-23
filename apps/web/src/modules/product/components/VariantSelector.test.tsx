import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
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

describe('VariantSelector', () => {
  it('không render gì khi sản phẩm không có attribute (chỉ variant mặc định)', () => {
    const onVariantChange = vi.fn();
    const { container } = render(
      withIntl(
        <VariantSelector
          attributes={[]}
          variants={[variant('v-default', [])]}
          onVariantChange={onVariantChange}
        />,
      ),
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('báo variant mặc định ngay khi mount nếu sản phẩm không có attribute', () => {
    const onVariantChange = vi.fn();
    const defaultVariant = variant('v-default', []);
    render(
      withIntl(
        <VariantSelector
          attributes={[]}
          variants={[defaultVariant]}
          onVariantChange={onVariantChange}
        />,
      ),
    );

    expect(onVariantChange).toHaveBeenCalledWith(defaultVariant);
  });

  it('render đủ mọi attribute + giá trị', () => {
    render(
      withIntl(
        <VariantSelector attributes={attributes} variants={variants} onVariantChange={vi.fn()} />,
      ),
    );

    expect(screen.getByText('Màu sắc')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đỏ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xanh' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'M' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'L' })).toBeInTheDocument();
  });

  it('gọi onVariantChange(undefined) khi mới chọn 1 phần combo (chưa đủ)', async () => {
    const onVariantChange = vi.fn();
    const user = userEvent.setup();
    render(
      withIntl(
        <VariantSelector
          attributes={attributes}
          variants={variants}
          onVariantChange={onVariantChange}
        />,
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Đỏ' }));

    expect(onVariantChange).toHaveBeenLastCalledWith(undefined);
  });

  it('gọi onVariantChange(variant) đúng khi chọn đủ combo khớp', async () => {
    const onVariantChange = vi.fn();
    const user = userEvent.setup();
    render(
      withIntl(
        <VariantSelector
          attributes={attributes}
          variants={variants}
          onVariantChange={onVariantChange}
        />,
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Đỏ' }));
    await user.click(screen.getByRole('button', { name: 'M' }));

    expect(onVariantChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'v-do-m' }));
  });

  it('bấm lại giá trị đang chọn để bỏ chọn (toggle off)', async () => {
    const onVariantChange = vi.fn();
    const user = userEvent.setup();
    render(
      withIntl(
        <VariantSelector
          attributes={attributes}
          variants={variants}
          onVariantChange={onVariantChange}
        />,
      ),
    );

    const doButton = screen.getByRole('button', { name: 'Đỏ' });
    await user.click(doButton);
    expect(doButton).toHaveAttribute('aria-pressed', 'true');

    await user.click(doButton);
    expect(doButton).toHaveAttribute('aria-pressed', 'false');
    expect(onVariantChange).toHaveBeenLastCalledWith(undefined);
  });

  it('disable đúng option hết hàng theo combo đã chọn, không disable cả sản phẩm', async () => {
    const user = userEvent.setup();
    render(
      withIntl(
        <VariantSelector attributes={attributes} variants={variants} onVariantChange={vi.fn()} />,
      ),
    );

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

  it('không cho chọn giá trị đang disabled (click không có tác dụng)', async () => {
    const onVariantChange = vi.fn();
    const user = userEvent.setup();
    render(
      withIntl(
        <VariantSelector
          attributes={attributes}
          variants={variants}
          onVariantChange={onVariantChange}
        />,
      ),
    );

    await user.click(screen.getByRole('button', { name: 'L' }));
    onVariantChange.mockClear();

    await user.click(screen.getByRole('button', { name: /Đỏ/ })); // đang disabled
    expect(onVariantChange).not.toHaveBeenCalled();
  });
});
