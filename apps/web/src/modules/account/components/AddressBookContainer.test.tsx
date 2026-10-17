import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { AddressBookContainer } from './AddressBookContainer';

type Mutate = (id: string, options?: { onSuccess?: () => void; onError?: () => void }) => void;

const mocks = vi.hoisted(() => ({
  query: {
    isPending: false,
    isError: false,
    data: [] as unknown[],
    refetch: vi.fn(),
  },
  setDefault: { mutate: vi.fn(), isPending: false },
  remove: { mutate: vi.fn(), isPending: false },
  formProps: [] as Array<Record<string, unknown>>,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: mocks.toast }));
// Giả cả barrel: dữ liệu và mutation do test điều khiển; AddressFormContainer thật có test riêng ở
// modules/checkout nên ở đây chỉ cần biết nó được mở ở chế độ nào và cho phép bấm "hoàn tất".
vi.mock('@/modules/checkout', () => ({
  useAddresses: () => mocks.query,
  useSetDefaultAddress: () => mocks.setDefault,
  useDeleteAddress: () => mocks.remove,
  AddressFormContainer: (props: Record<string, unknown>) => {
    mocks.formProps.push(props);
    const address = props.address as { id: string } | undefined;
    return (
      <div data-testid="address-form">
        <span>{address ? `edit:${address.id}` : 'create'}</span>
        <button type="button" onClick={() => (props.onCreated as () => void)?.()}>
          mock-created
        </button>
        <button type="button" onClick={() => (props.onUpdated as () => void)?.()}>
          mock-updated
        </button>
        <button type="button" onClick={() => (props.onCancel as () => void)?.()}>
          mock-cancel
        </button>
      </div>
    );
  },
}));

function makeAddress(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `address-${index}`,
    recipientName: `Người nhận ${index}`,
    phone: '0912345678',
    line1: `${index} Nguyễn Huệ`,
    ward: 'Phường Bến Nghé',
    province: 'Hồ Chí Minh',
    isDefault: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function setAddresses(count: number, defaultIndex = 1) {
  mocks.query.data = Array.from({ length: count }, (_, i) =>
    makeAddress(i + 1, { isDefault: i + 1 === defaultIndex }),
  );
}

function renderBook() {
  return render(withIntl(<AddressBookContainer />));
}

describe('AddressBookContainer', () => {
  beforeEach(() => {
    mocks.query.isPending = false;
    mocks.query.isError = false;
    mocks.query.data = [];
    mocks.query.refetch.mockReset();
    mocks.setDefault.mutate.mockReset();
    mocks.setDefault.isPending = false;
    mocks.remove.mutate.mockReset();
    mocks.remove.isPending = false;
    mocks.formProps.length = 0;
    mocks.toast.success.mockReset();
    mocks.toast.error.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  describe('trạng thái dữ liệu', () => {
    it('đang tải -> skeleton có aria-busy kèm chữ cho trình đọc màn hình', () => {
      mocks.query.isPending = true;
      const { container } = renderBook();

      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(screen.getByText('Đang tải...')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Thêm địa chỉ' })).not.toBeInTheDocument();
    });

    it('lỗi tải -> thông báo (không lộ message BE) + nút Thử lại gọi refetch', async () => {
      const user = userEvent.setup();
      mocks.query.isError = true;
      renderBook();

      expect(screen.getByRole('alert')).toHaveTextContent('Không tải được sổ địa chỉ');
      await user.click(screen.getByRole('button', { name: 'Thử lại' }));

      expect(mocks.query.refetch).toHaveBeenCalledTimes(1);
    });

    it('chưa có địa chỉ -> câu trống, nút thêm vẫn dùng được', () => {
      renderBook();

      expect(screen.getByText(/Bạn chưa có địa chỉ nào/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Thêm địa chỉ' })).toBeEnabled();
    });

    it('có địa chỉ -> liệt kê từng địa chỉ, nhãn mặc định đúng một dòng, đếm "đã lưu n/10"', () => {
      setAddresses(3, 2);
      renderBook();

      expect(screen.getAllByRole('listitem')).toHaveLength(3);
      expect(screen.getAllByText('Mặc định')).toHaveLength(1);
      expect(screen.getByText('Đã lưu 3/10 địa chỉ')).toBeInTheDocument();
    });
  });

  describe('giới hạn 10 địa chỉ', () => {
    it('9 địa chỉ -> vẫn thêm được, không có câu giới hạn', () => {
      setAddresses(9);
      renderBook();

      expect(screen.getByRole('button', { name: 'Thêm địa chỉ' })).toBeEnabled();
      expect(screen.queryByText(/tối đa 10 địa chỉ/)).not.toBeInTheDocument();
    });

    it('đủ 10 địa chỉ -> khoá nút thêm và giải thích cách xử lý', () => {
      setAddresses(10);
      renderBook();

      expect(screen.getByRole('button', { name: 'Thêm địa chỉ' })).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent('tối đa 10 địa chỉ');
    });
  });

  describe('thêm địa chỉ', () => {
    it('bấm Thêm -> mở form tạo mới (không có `address`) và khoá nút Thêm (chỉ một form một lúc)', async () => {
      const user = userEvent.setup();
      setAddresses(2);
      renderBook();

      await user.click(screen.getByRole('button', { name: 'Thêm địa chỉ' }));

      const form = screen.getByTestId('address-form');
      expect(within(form).getByText('create')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Thêm địa chỉ' })).toBeDisabled();
      // Đang thêm thì không mở thêm form sửa nào khác — mọi nút "Sửa" vẫn bấm được nhưng chỉ có MỘT form.
      expect(screen.getAllByTestId('address-form')).toHaveLength(1);
    });

    it('tạo xong -> đóng form và báo thành công', async () => {
      const user = userEvent.setup();
      renderBook();
      await user.click(screen.getByRole('button', { name: 'Thêm địa chỉ' }));

      await user.click(screen.getByRole('button', { name: 'mock-created' }));

      expect(screen.queryByTestId('address-form')).not.toBeInTheDocument();
      expect(mocks.toast.success).toHaveBeenCalledWith('Đã thêm địa chỉ');
    });

    it('Hủy -> đóng form, không báo gì', async () => {
      const user = userEvent.setup();
      renderBook();
      await user.click(screen.getByRole('button', { name: 'Thêm địa chỉ' }));

      await user.click(screen.getByRole('button', { name: 'mock-cancel' }));

      expect(screen.queryByTestId('address-form')).not.toBeInTheDocument();
      expect(mocks.toast.success).not.toHaveBeenCalled();
    });

    it('danh sách trống + đang mở form thêm -> không hiện thêm câu "chưa có địa chỉ"', async () => {
      const user = userEvent.setup();
      renderBook();

      await user.click(screen.getByRole('button', { name: 'Thêm địa chỉ' }));

      expect(screen.queryByText(/Bạn chưa có địa chỉ nào/)).not.toBeInTheDocument();
    });
  });

  describe('sửa địa chỉ', () => {
    it('bấm Sửa -> thẻ đó đổi thành form sửa với đúng địa chỉ, các thẻ khác giữ nguyên', async () => {
      const user = userEvent.setup();
      setAddresses(3);
      renderBook();

      await user.click(screen.getByRole('button', { name: 'Sửa địa chỉ của Người nhận 2' }));

      const form = screen.getByTestId('address-form');
      expect(within(form).getByText('edit:address-2')).toBeInTheDocument();
      expect(screen.getByText('Người nhận 1 · 0912345678')).toBeInTheDocument();
      expect(screen.getByText('Người nhận 3 · 0912345678')).toBeInTheDocument();
      expect(screen.queryByText('Người nhận 2 · 0912345678')).not.toBeInTheDocument();
      // Đang sửa thì không cho thêm: form dùng id cố định cho từng ô, hai form trùng id.
      expect(screen.getByRole('button', { name: 'Thêm địa chỉ' })).toBeDisabled();
    });

    it('sửa xong -> đóng form và báo đã cập nhật', async () => {
      const user = userEvent.setup();
      setAddresses(2);
      renderBook();
      await user.click(screen.getByRole('button', { name: 'Sửa địa chỉ của Người nhận 1' }));

      await user.click(screen.getByRole('button', { name: 'mock-updated' }));

      expect(screen.queryByTestId('address-form')).not.toBeInTheDocument();
      expect(mocks.toast.success).toHaveBeenCalledWith('Đã cập nhật địa chỉ');
      expect(screen.getByText('Người nhận 1 · 0912345678')).toBeInTheDocument();
    });
  });

  describe('đặt mặc định', () => {
    it('bấm -> gọi hook với đúng id; thành công thì báo', async () => {
      const user = userEvent.setup();
      mocks.setDefault.mutate.mockImplementation(((_id, options) =>
        options?.onSuccess?.()) as Mutate);
      setAddresses(2, 1);
      renderBook();

      await user.click(
        screen.getByRole('button', { name: 'Đặt địa chỉ của Người nhận 2 làm mặc định' }),
      );

      expect(mocks.setDefault.mutate.mock.calls[0][0]).toBe('address-2');
      expect(mocks.toast.success).toHaveBeenCalledWith('Đã đặt làm địa chỉ mặc định');
    });

    it('thất bại -> toast lỗi chung, không lộ message BE', async () => {
      const user = userEvent.setup();
      mocks.setDefault.mutate.mockImplementation(((_id, options) =>
        options?.onError?.()) as Mutate);
      setAddresses(2, 1);
      renderBook();

      await user.click(
        screen.getByRole('button', { name: 'Đặt địa chỉ của Người nhận 2 làm mặc định' }),
      );

      expect(mocks.toast.error).toHaveBeenCalledWith('Không thực hiện được, vui lòng thử lại sau');
    });
  });

  describe('xoá địa chỉ (phải xác nhận)', () => {
    it('bấm Xoá -> chỉ mở hộp thoại, CHƯA xoá', async () => {
      const user = userEvent.setup();
      setAddresses(2);
      renderBook();

      await user.click(screen.getByRole('button', { name: 'Xoá địa chỉ của Người nhận 2' }));
      // Chờ hết việc đang treo rồi mới khẳng định điều "không xảy ra" (rules/frontend.md mục 8).
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(screen.getByText('Xoá địa chỉ này?')).toBeInTheDocument();
      expect(screen.getByText(/Địa chỉ của Người nhận 2 sẽ bị xoá/)).toBeInTheDocument();
      expect(mocks.remove.mutate).not.toHaveBeenCalled();
    });

    it('xác nhận -> xoá đúng id, đóng hộp thoại, báo thành công', async () => {
      const user = userEvent.setup();
      mocks.remove.mutate.mockImplementation(((_id, options) => options?.onSuccess?.()) as Mutate);
      setAddresses(2);
      renderBook();
      await user.click(screen.getByRole('button', { name: 'Xoá địa chỉ của Người nhận 2' }));

      await user.click(screen.getByRole('button', { name: 'Xoá địa chỉ' }));

      expect(mocks.remove.mutate.mock.calls[0][0]).toBe('address-2');
      expect(screen.queryByText('Xoá địa chỉ này?')).not.toBeInTheDocument();
      expect(mocks.toast.success).toHaveBeenCalledWith('Đã xoá địa chỉ');
    });

    it('"Giữ lại" -> đóng hộp thoại và KHÔNG xoá', async () => {
      const user = userEvent.setup();
      setAddresses(2);
      renderBook();
      await user.click(screen.getByRole('button', { name: 'Xoá địa chỉ của Người nhận 2' }));

      await user.click(screen.getByRole('button', { name: 'Giữ lại' }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(screen.queryByText('Xoá địa chỉ này?')).not.toBeInTheDocument();
      expect(mocks.remove.mutate).not.toHaveBeenCalled();
    });

    it('xoá lỗi -> GIỮ hộp thoại để thử lại, toast lỗi chung', async () => {
      const user = userEvent.setup();
      mocks.remove.mutate.mockImplementation(((_id, options) => options?.onError?.()) as Mutate);
      setAddresses(2);
      renderBook();
      await user.click(screen.getByRole('button', { name: 'Xoá địa chỉ của Người nhận 2' }));

      await user.click(screen.getByRole('button', { name: 'Xoá địa chỉ' }));

      expect(screen.getByText('Xoá địa chỉ này?')).toBeInTheDocument();
      expect(mocks.toast.error).toHaveBeenCalledWith('Không thực hiện được, vui lòng thử lại sau');
    });

    it('xoá địa chỉ MẶC ĐỊNH khi còn địa chỉ khác -> báo trước địa chỉ nào lên thay', async () => {
      const user = userEvent.setup();
      setAddresses(2, 1);
      renderBook();

      await user.click(screen.getByRole('button', { name: 'Xoá địa chỉ của Người nhận 1' }));

      expect(
        screen.getByText(/Địa chỉ được thêm gần nhất sẽ trở thành mặc định/),
      ).toBeInTheDocument();
    });

    it('xoá địa chỉ thường, hoặc địa chỉ mặc định DUY NHẤT -> không có dòng chú ý đó', async () => {
      const user = userEvent.setup();
      setAddresses(2, 1);
      const first = renderBook();
      await user.click(screen.getByRole('button', { name: 'Xoá địa chỉ của Người nhận 2' }));
      expect(screen.queryByText(/sẽ trở thành mặc định/)).not.toBeInTheDocument();

      first.unmount();
      cleanup();
      setAddresses(1, 1);
      renderBook();
      await user.click(screen.getByRole('button', { name: 'Xoá địa chỉ của Người nhận 1' }));
      expect(screen.queryByText(/sẽ trở thành mặc định/)).not.toBeInTheDocument();
    });

    it('xoá một địa chỉ KHÁC khi đang sửa -> form sửa vẫn còn nguyên', async () => {
      const user = userEvent.setup();
      mocks.remove.mutate.mockImplementation(((_id, options) => options?.onSuccess?.()) as Mutate);
      setAddresses(2);
      renderBook();
      // Form sửa chiếm chỗ thẻ 1 (thẻ đó không còn nút Xoá — không thể xoá chính địa chỉ đang sửa).
      await user.click(screen.getByRole('button', { name: 'Sửa địa chỉ của Người nhận 1' }));
      expect(screen.getByTestId('address-form')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Xoá địa chỉ của Người nhận 2' }));
      await user.click(screen.getByRole('button', { name: 'Xoá địa chỉ' }));

      expect(mocks.remove.mutate.mock.calls[0][0]).toBe('address-2');
      expect(screen.getByTestId('address-form')).toBeInTheDocument();
    });
  });

  it('đang có thao tác ghi -> khoá mọi nút trên thẻ (không bấm chồng)', () => {
    mocks.setDefault.isPending = true;
    setAddresses(2);
    renderBook();

    expect(screen.getByRole('button', { name: 'Sửa địa chỉ của Người nhận 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xoá địa chỉ của Người nhận 2' })).toBeDisabled();
  });
});
