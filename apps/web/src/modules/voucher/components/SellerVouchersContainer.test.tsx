import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { useCreateVoucher } from '../hooks/useCreateVoucher';
import { useSetVoucherActive } from '../hooks/useSetVoucherActive';
import { useShopVouchers } from '../hooks/useShopVouchers';
import type { Voucher } from '../types';
import { SellerVouchersContainer } from './SellerVouchersContainer';

const toastSuccess = vi.fn();

vi.mock('sonner', () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() },
}));
vi.mock('../hooks/useShopVouchers', () => ({ useShopVouchers: vi.fn() }));
vi.mock('../hooks/useCreateVoucher', () => ({ useCreateVoucher: vi.fn() }));
vi.mock('../hooks/useSetVoucherActive', () => ({ useSetVoucherActive: vi.fn() }));

function voucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: 'voucher-1',
    shopId: 'shop-1',
    code: 'SALE10',
    type: 'PERCENT',
    value: '10',
    minOrderAmount: null,
    maxDiscountAmount: null,
    usageLimit: null,
    perUserLimit: null,
    usedCount: 0,
    isActive: true,
    expiresAt: null,
    createdAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

function mockList(state: { data?: Voucher[]; isPending?: boolean; isError?: boolean }) {
  vi.mocked(useShopVouchers).mockReturnValue({
    data: state.data,
    isPending: state.isPending ?? false,
    isError: state.isError ?? false,
  } as unknown as ReturnType<typeof useShopVouchers>);
}

function mockMutations(options: { createError?: Error; toggleError?: Error } = {}) {
  const create = vi.fn(async () => {
    if (options.createError) throw options.createError;
    return voucher();
  });
  const setActive = vi.fn(async () => {
    if (options.toggleError) throw options.toggleError;
    return voucher();
  });
  vi.mocked(useCreateVoucher).mockReturnValue({
    mutateAsync: create,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateVoucher>);
  vi.mocked(useSetVoucherActive).mockReturnValue({
    mutateAsync: setActive,
    isPending: false,
  } as unknown as ReturnType<typeof useSetVoucherActive>);
  return { create, setActive };
}

function renderContainer() {
  return render(withIntl(<SellerVouchersContainer shopId="shop-1" />));
}

async function fillAndSubmitForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Tạo voucher' }));
  await user.type(screen.getByLabelText('Mã voucher'), 'NEW10');
  await user.type(screen.getByLabelText('Phần trăm giảm (%)'), '10');
  const section = screen.getByRole('region', { name: 'Tạo voucher mới' });
  await user.click(within(section).getByRole('button', { name: 'Tạo voucher' }));
}

describe('SellerVouchersContainer', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    mockMutations();
  });

  describe('trạng thái danh sách', () => {
    it('đang tải -> skeleton, aria-busy và dòng sr-only', () => {
      mockList({ isPending: true });

      const { container } = renderContainer();

      expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
      expect(screen.getByText('Đang tải...')).toHaveClass('sr-only');
    });

    it('lỗi -> thông báo role=alert', () => {
      mockList({ isError: true });

      renderContainer();

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Không tải được danh sách voucher, vui lòng thử lại',
      );
    });

    it('chưa có voucher -> thông báo trống', () => {
      mockList({ data: [] });

      renderContainer();

      expect(screen.getByText('Shop chưa có voucher nào.')).toBeInTheDocument();
    });
  });

  describe('hiển thị từng voucher', () => {
    it('PERCENT: hiện mã, "Giảm N%", mô tả điều kiện và trạng thái Đang bật', () => {
      mockList({
        data: [
          voucher({
            minOrderAmount: '200000',
            maxDiscountAmount: '50000',
            usageLimit: 100,
            usedCount: 3,
            perUserLimit: 1,
          }),
        ],
      });

      renderContainer();

      const row = screen.getByText('SALE10').closest('li') as HTMLElement;
      expect(within(row).getByText('Giảm 10%')).toBeInTheDocument();
      expect(within(row).getByText('Đang bật')).toBeInTheDocument();
      expect(row).toHaveTextContent('Đơn tối thiểu 200.000 ₫');
      expect(row).toHaveTextContent('Giảm tối đa 50.000 ₫');
      expect(row).toHaveTextContent('Đã dùng 3/100');
      expect(row).toHaveTextContent('Tối đa 1 lần/người');
      expect(row).toHaveTextContent('Không thời hạn');
    });

    it('FIXED: hiện số tiền giảm qua formatPrice, không hiện "giảm tối đa"', () => {
      mockList({
        data: [
          voucher({ code: 'GIAM50K', type: 'FIXED', value: '50000', maxDiscountAmount: '9999' }),
        ],
      });

      renderContainer();

      const row = screen.getByText('GIAM50K').closest('li') as HTMLElement;
      expect(within(row).getByText('Giảm 50.000 ₫')).toBeInTheDocument();
      expect(row).not.toHaveTextContent('Giảm tối đa');
      expect(row).toHaveTextContent('Đã dùng 0');
    });

    it('voucher đã tắt -> badge Đã tắt và nút Bật', () => {
      mockList({ data: [voucher({ isActive: false })] });

      renderContainer();

      expect(screen.getByText('Đã tắt')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Bật' })).toBeInTheDocument();
    });

    it('voucher quá hạn -> badge Hết hạn (dù cờ bật) và KHÔNG có nút bật/tắt', () => {
      mockList({ data: [voucher({ expiresAt: '2020-01-01T00:00:00.000Z' })] });

      renderContainer();

      expect(
        screen.getByText('Hết hạn', { selector: 'span[data-slot="badge"]' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Tắt' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Bật' })).not.toBeInTheDocument();
    });
  });

  describe('bật/tắt', () => {
    it('tắt voucher đang chạy -> hỏi xác nhận (AlertDialog), chưa gọi API', async () => {
      const { setActive } = mockMutations();
      mockList({ data: [voucher()] });
      const user = userEvent.setup();
      renderContainer();

      await user.click(screen.getByRole('button', { name: 'Tắt' }));

      const dialog = await screen.findByRole('alertdialog');
      expect(dialog).toHaveTextContent('Tắt voucher SALE10?');
      expect(setActive).not.toHaveBeenCalled();
    });

    it('xác nhận -> gọi tắt đúng voucher', async () => {
      const { setActive } = mockMutations();
      mockList({ data: [voucher()] });
      const user = userEvent.setup();
      renderContainer();
      await user.click(screen.getByRole('button', { name: 'Tắt' }));

      const dialog = await screen.findByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Tắt' }));

      await vi.waitFor(() =>
        expect(setActive).toHaveBeenCalledWith({ voucherId: 'voucher-1', isActive: false }),
      );
    });

    it('huỷ hộp thoại -> không gọi API', async () => {
      const { setActive } = mockMutations();
      mockList({ data: [voucher()] });
      const user = userEvent.setup();
      renderContainer();
      await user.click(screen.getByRole('button', { name: 'Tắt' }));

      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Huỷ' }),
      );

      expect(setActive).not.toHaveBeenCalled();
    });

    it('bật lại voucher đã tắt -> gọi ngay, KHÔNG hỏi xác nhận (dễ hoàn tác)', async () => {
      const { setActive } = mockMutations();
      mockList({ data: [voucher({ isActive: false })] });
      const user = userEvent.setup();
      renderContainer();

      await user.click(screen.getByRole('button', { name: 'Bật' }));

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      await vi.waitFor(() =>
        expect(setActive).toHaveBeenCalledWith({ voucherId: 'voucher-1', isActive: true }),
      );
    });

    it('API lỗi -> hiện thông báo, không lộ message của BE', async () => {
      mockMutations({ toggleError: new ApiError('Voucher not found', 404) });
      mockList({ data: [voucher({ isActive: false })] });
      const user = userEvent.setup();
      renderContainer();

      await user.click(screen.getByRole('button', { name: 'Bật' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Không cập nhật được trạng thái voucher, vui lòng thử lại',
      );
    });
  });

  describe('tạo voucher', () => {
    it('form đóng sẵn; bấm "Tạo voucher" mở, bấm lại (Huỷ) đóng', async () => {
      mockList({ data: [] });
      const user = userEvent.setup();
      renderContainer();
      expect(screen.queryByLabelText('Mã voucher')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Tạo voucher' }));
      expect(screen.getByLabelText('Mã voucher')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Huỷ' }));
      expect(screen.queryByLabelText('Mã voucher')).not.toBeInTheDocument();
    });

    it('tạo thành công -> gọi API với số đã chuyển đổi, toast, đóng form', async () => {
      const { create } = mockMutations();
      mockList({ data: [] });
      const user = userEvent.setup();
      renderContainer();

      await fillAndSubmitForm(user);

      await vi.waitFor(() =>
        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'NEW10', type: 'PERCENT', value: 10 }),
        ),
      );
      expect(toastSuccess).toHaveBeenCalledWith('Đã tạo voucher');
      await vi.waitFor(() => expect(screen.queryByLabelText('Mã voucher')).not.toBeInTheDocument());
    });

    it('trùng mã (409) -> báo đã dịch, form vẫn mở để sửa', async () => {
      mockMutations({ createError: new ApiError('Voucher code already exists', 409) });
      mockList({ data: [] });
      const user = userEvent.setup();
      renderContainer();

      await fillAndSubmitForm(user);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Mã voucher này đã tồn tại, hãy chọn mã khác',
      );
      expect(screen.getByLabelText('Mã voucher')).toBeInTheDocument();
      expect(toastSuccess).not.toHaveBeenCalled();
    });

    it('lỗi khác -> báo lỗi chung', async () => {
      mockMutations({ createError: new Error('network') });
      mockList({ data: [] });
      const user = userEvent.setup();
      renderContainer();

      await fillAndSubmitForm(user);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Không tạo được voucher, vui lòng thử lại',
      );
    });
  });

  it('có link quay lại trang sản phẩm của Seller', () => {
    mockList({ data: [] });

    renderContainer();

    expect(screen.getByRole('link', { name: 'Quay lại sản phẩm' })).toHaveAttribute(
      'href',
      '/seller/products',
    );
  });
});
