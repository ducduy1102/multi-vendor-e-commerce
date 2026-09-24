import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import type { Category } from '../types';

import { ProductForm, type ProductFormValues } from './ProductForm';

const categories: Category[] = [{ id: 'cat-1', name: 'Áo nam', slug: 'ao-nam', parentId: null }];

// ProductForm giờ gián tiếp dùng useUploadSignature (VariantImagesUpload,
// Week4.md Bước 3.8, Week5.md Bước 3.13) — cần QueryClientProvider để render
// được, khác các test trước đó (chỉ react-hook-form, không cần). 1
// QueryClient mới mỗi lần render, không cache chéo giữa các test.
function renderProductForm(ui: ReactElement) {
  const queryClient = new QueryClient();
  return render(withIntl(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
}

async function addAttribute(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  values: string[],
) {
  await user.click(screen.getByRole('button', { name: '+ Thêm thuộc tính' }));
  const nameInputs = screen.getAllByPlaceholderText('Tên thuộc tính (vd: Màu sắc)');
  const nameInput = nameInputs[nameInputs.length - 1];
  await user.type(nameInput, name);

  // Mỗi attribute mới sinh sẵn 1 ô giá trị rỗng — điền giá trị đầu tiên vào
  // đó, bấm "+ Thêm giá trị" cho các giá trị còn lại.
  for (let i = 0; i < values.length; i++) {
    if (i > 0) {
      const addValueButtons = screen.getAllByRole('button', { name: '+ Thêm giá trị' });
      await user.click(addValueButtons[addValueButtons.length - 1]);
    }
    const valueInputs = screen.getAllByPlaceholderText('Giá trị (vd: Đỏ)');
    await user.type(valueInputs[valueInputs.length - 1], values[i]);
  }
  nameInput.blur();
  screen.getAllByPlaceholderText('Giá trị (vd: Đỏ)').forEach((el) => el.blur());
}

async function fillBasicFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Tên sản phẩm'), 'Áo thun nam');
  await user.selectOptions(screen.getByLabelText('Danh mục'), 'cat-1');
}

describe('ProductForm', () => {
  it('hiển thị đúng 1 dòng variant mặc định khi chưa có attribute nào', () => {
    renderProductForm(<ProductForm mode="create" categories={categories} onSubmit={vi.fn()} />);

    expect(screen.getAllByLabelText('SKU')).toHaveLength(1);
    expect(screen.getByText('Mặc định (không có thuộc tính)')).toBeInTheDocument();
  });

  it('thêm 1 attribute với 2 giá trị sinh đúng 2 dòng variant', async () => {
    const user = userEvent.setup();
    renderProductForm(<ProductForm mode="create" categories={categories} onSubmit={vi.fn()} />);

    await addAttribute(user, 'Màu sắc', ['Đỏ', 'Xanh']);

    expect(screen.getAllByLabelText('SKU')).toHaveLength(2);
    expect(screen.getByText('Màu sắc: Đỏ')).toBeInTheDocument();
    expect(screen.getByText('Màu sắc: Xanh')).toBeInTheDocument();
  });

  it('thêm attribute thứ 2 sinh đúng tích Descartes (2x2 = 4 dòng)', async () => {
    const user = userEvent.setup();
    renderProductForm(<ProductForm mode="create" categories={categories} onSubmit={vi.fn()} />);

    await addAttribute(user, 'Màu sắc', ['Đỏ', 'Xanh']);
    await addAttribute(user, 'Size', ['M', 'L']);

    expect(screen.getAllByLabelText('SKU')).toHaveLength(4);
    expect(screen.getByText('Màu sắc: Đỏ, Size: M')).toBeInTheDocument();
    expect(screen.getByText('Màu sắc: Xanh, Size: L')).toBeInTheDocument();
  });

  it('xoá 1 giá trị làm mất đúng dòng tương ứng, giữ nguyên dữ liệu dòng còn lại', async () => {
    const user = userEvent.setup();
    renderProductForm(<ProductForm mode="create" categories={categories} onSubmit={vi.fn()} />);

    await addAttribute(user, 'Màu sắc', ['Đỏ', 'Xanh']);
    expect(screen.getAllByLabelText('SKU')).toHaveLength(2);

    // Điền giá cho dòng "Đỏ" (dòng đầu) trước khi xoá "Xanh".
    await user.type(screen.getAllByLabelText('Giá')[0], '150000');

    await user.click(screen.getAllByRole('button', { name: 'Xoá' })[1]);

    expect(screen.getAllByLabelText('SKU')).toHaveLength(1);
    expect(screen.getByText('Màu sắc: Đỏ')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Giá')[0]).toHaveValue(150000);
  });

  it('submit hợp lệ gọi onSubmit với payload đã convert đúng shape (price/stock thành number)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderProductForm(<ProductForm mode="create" categories={categories} onSubmit={onSubmit} />);

    await fillBasicFields(user);
    await addAttribute(user, 'Màu sắc', ['Đỏ']);
    // SKU đã có sẵn giá trị tự sinh (từ buildVariantMatrix) — clear trước
    // khi type, userEvent.type() chỉ nối thêm ký tự, không tự xoá.
    await user.clear(screen.getAllByLabelText('SKU')[0]);
    await user.type(screen.getAllByLabelText('SKU')[0], 'AT-DO');
    await user.type(screen.getAllByLabelText('Giá')[0], '150000');
    await user.type(screen.getAllByLabelText('Tồn kho')[0], '10');

    await user.click(screen.getByRole('button', { name: 'Tạo sản phẩm' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Áo thun nam',
        categoryId: 'cat-1',
        description: undefined,
        status: undefined,
        attributes: [{ id: undefined, name: 'Màu sắc', values: [{ id: undefined, value: 'Đỏ' }] }],
        variants: [{ sku: 'AT-DO', price: 150000, stock: 10, attributeValues: ['Đỏ'], images: [] }],
      }),
    );
  });

  it('chặn submit và báo lỗi khi 2 variant trùng SKU', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderProductForm(<ProductForm mode="create" categories={categories} onSubmit={onSubmit} />);

    await fillBasicFields(user);
    await addAttribute(user, 'Màu sắc', ['Đỏ', 'Xanh']);

    const skuInputs = screen.getAllByLabelText('SKU');
    const priceInputs = screen.getAllByLabelText('Giá');
    const stockInputs = screen.getAllByLabelText('Tồn kho');
    for (let i = 0; i < 2; i++) {
      await user.clear(skuInputs[i]);
      await user.type(skuInputs[i], 'AT-DUP');
      await user.type(priceInputs[i], '100000');
      await user.type(stockInputs[i], '5');
    }

    await user.click(screen.getByRole('button', { name: 'Tạo sản phẩm' }));

    expect(await screen.findByText('SKU "AT-DUP" bị lặp lại')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('báo lỗi ngay tại ô giá trị khi 2 giá trị trong cùng thuộc tính trùng nhau (không phân biệt hoa/thường)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderProductForm(<ProductForm mode="create" categories={categories} onSubmit={onSubmit} />);

    // Đúng bug thật gặp trong ảnh seller gửi lên: attribute "Size" khai
    // "M" 2 lần — addAttribute() đã tự blur() từng ô giá trị ở cuối, nên lỗi
    // phải hiện NGAY (mode: 'onBlur'), không cần đợi tới lúc bấm submit.
    await addAttribute(user, 'Size', ['M', 'M']);

    expect(
      await screen.findByText(
        'Giá trị "M" đã tồn tại trong thuộc tính này (không phân biệt hoa/thường)',
      ),
    ).toBeInTheDocument();

    await fillBasicFields(user);
    const skuInputs = screen.getAllByLabelText('SKU');
    const priceInputs = screen.getAllByLabelText('Giá');
    const stockInputs = screen.getAllByLabelText('Tồn kho');
    for (let i = 0; i < skuInputs.length; i++) {
      await user.clear(skuInputs[i]);
      await user.type(skuInputs[i], `SKU-${i}`);
      await user.type(priceInputs[i], '100000');
      await user.type(stockInputs[i], '5');
    }

    await user.click(screen.getByRole('button', { name: 'Tạo sản phẩm' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('hiện field status ở mode edit, không hiện ở mode create', () => {
    renderProductForm(<ProductForm mode="create" categories={categories} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Trạng thái')).not.toBeInTheDocument();

    renderProductForm(
      <ProductForm
        mode="edit"
        categories={categories}
        onSubmit={vi.fn()}
        defaultValues={{
          name: 'Áo thun nam',
          categoryId: 'cat-1',
          description: '',
          status: 'PUBLISHED',
          attributes: [],
          variants: [{ sku: 'AT-1', price: '100000', stock: '5', attributeValues: [], images: [] }],
        }}
      />,
    );
    expect(screen.getByLabelText('Trạng thái')).toBeInTheDocument();
  });

  // Week5.md — id-based reconcile (chặn đứng data rác khi seller đổi tên
  // attribute/value): productToFormValues() mang attributeId/valueId từ
  // response GET vào form (Bước 4); các test dưới đây khoá lại đúng vòng
  // đời round-trip qua RHF state -> toSubmitPayload() -> payload gửi BE.
  describe('mode edit — giữ nguyên attributeId/valueId qua vòng đời form', () => {
    const editDefaultValues: ProductFormValues = {
      name: 'Áo thun nam',
      categoryId: 'cat-1',
      description: '',
      status: 'PUBLISHED',
      attributes: [
        {
          attributeId: 'attr-1',
          name: 'Màu sắc',
          values: [{ valueId: 'val-1', value: 'Đỏ' }],
        },
      ],
      variants: [
        {
          sku: 'AT-1',
          price: '100000',
          stock: '5',
          attributeValues: ['Đỏ'],
          images: [],
        },
      ],
    };

    it('submit không đổi gì -> giữ nguyên đúng id cũ trong payload', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderProductForm(
        <ProductForm
          mode="edit"
          categories={categories}
          onSubmit={onSubmit}
          defaultValues={editDefaultValues}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

      await waitFor(() =>
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            attributes: [{ id: 'attr-1', name: 'Màu sắc', values: [{ id: 'val-1', value: 'Đỏ' }] }],
          }),
        ),
      );
    });

    it('đổi tên attribute -> vẫn giữ đúng id cũ, chỉ name đổi', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderProductForm(
        <ProductForm
          mode="edit"
          categories={categories}
          onSubmit={onSubmit}
          defaultValues={editDefaultValues}
        />,
      );

      const nameInput = screen.getByPlaceholderText('Tên thuộc tính (vd: Màu sắc)');
      await user.clear(nameInput);
      await user.type(nameInput, 'Màu sắc mới');
      nameInput.blur();

      await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

      await waitFor(() =>
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            attributes: [
              {
                id: 'attr-1',
                name: 'Màu sắc mới',
                values: [{ id: 'val-1', value: 'Đỏ' }],
              },
            ],
          }),
        ),
      );
    });

    it('thêm attribute mới -> entry mới không có id, entry cũ vẫn giữ nguyên id', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderProductForm(
        <ProductForm
          mode="edit"
          categories={categories}
          onSubmit={onSubmit}
          defaultValues={editDefaultValues}
        />,
      );

      await user.click(screen.getByRole('button', { name: '+ Thêm thuộc tính' }));
      const nameInputs = screen.getAllByPlaceholderText('Tên thuộc tính (vd: Màu sắc)');
      await user.type(nameInputs[nameInputs.length - 1], 'Size');
      const valueInputs = screen.getAllByPlaceholderText('Giá trị (vd: Đỏ)');
      await user.type(valueInputs[valueInputs.length - 1], 'M');
      valueInputs[valueInputs.length - 1].blur();

      // Đợi bảng ma trận variant regenerate xong (tổ hợp Đỏ+M) TRƯỚC KHI lấy
      // lại tham chiếu input SKU/giá/tồn kho — regenerateVariants() (chạy ở
      // onBlur) gọi variantsFieldArray.replace(), unmount dòng variant cũ và
      // mount dòng mới; lấy tham chiếu input ngay sau blur() (không đợi) có
      // thể vẫn còn trỏ vào node cũ đã unmount trước khi React kịp render
      // lại, khiến userEvent.type() sau đó gõ vào node đã rời DOM.
      await screen.findByText('Màu sắc: Đỏ, Size: M');

      // Điền sku/giá/tồn kho cho variant mới sinh (tổ hợp Đỏ+M) để pass
      // validate — không liên quan trọng tâm test (id), chỉ để submit được.
      const skuInputs = screen.getAllByLabelText('SKU');
      const priceInputs = screen.getAllByLabelText('Giá');
      const stockInputs = screen.getAllByLabelText('Tồn kho');
      for (let i = 0; i < skuInputs.length; i++) {
        await user.clear(skuInputs[i]);
        await user.type(skuInputs[i], `SKU-${i}`);
        await user.type(priceInputs[i], '100000');
        await user.type(stockInputs[i], '5');
      }

      await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
      const payload = onSubmit.mock.calls[0][0] as { attributes: { id?: string; name: string }[] };
      expect(payload.attributes).toHaveLength(2);
      expect(payload.attributes[0]).toMatchObject({ id: 'attr-1', name: 'Màu sắc' });
      expect(payload.attributes[1]).toMatchObject({ id: undefined, name: 'Size' });
    });
  });
});
