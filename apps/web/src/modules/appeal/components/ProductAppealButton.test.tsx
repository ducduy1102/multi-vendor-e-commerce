import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { makeOwnerAppeal, makeShopAppeals } from '../appeal.fixtures';
import { ProductAppealButton } from './ProductAppealButton';

const mocks = vi.hoisted(() => ({
  query: {
    current: {} as {
      data?: unknown;
      isPending: boolean;
      isError: boolean;
      refetch: ReturnType<typeof vi.fn>;
    },
  },
  mutateAsync: vi.fn(),
  isCreating: { current: false },
  queryArgs: vi.fn(),
}));

vi.mock('../hooks/useProductAppeals', () => ({
  useProductAppeals: (shopId: string, productId: string) => {
    mocks.queryArgs(shopId, productId);
    return mocks.query.current;
  },
}));
vi.mock('../hooks/useCreateProductAppeal', () => ({
  useCreateProductAppeal: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: mocks.isCreating.current,
  }),
}));

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';

function renderButton(locale: 'vi' | 'en' = 'vi') {
  return render(
    withIntl(
      <ProductAppealButton shopId={SHOP_ID} productId={PRODUCT_ID} productName="Dao bấm tự động" />,
      locale,
    ),
  );
}

function respondWith(data: ReturnType<typeof makeShopAppeals>) {
  mocks.query.current = { data, isPending: false, isError: false, refetch: vi.fn() };
}

describe('ProductAppealButton', () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.isCreating.current = false;
    mocks.queryArgs.mockReset();
    mocks.query.current = { isPending: true, isError: false, refetch: vi.fn() };
  });

  afterEach(() => {
    cleanup();
  });

  it('hỏi đúng shop và sản phẩm của dòng', () => {
    respondWith(makeShopAppeals({ canAppeal: true }));
    renderButton();

    expect(mocks.queryArgs).toHaveBeenCalledWith(SHOP_ID, PRODUCT_ID);
  });

  it('đang tải: giữ chỗ đúng cỡ nút (ẩn khỏi trình đọc màn hình), chưa có nút nào', () => {
    const { container } = renderButton();

    const placeholder = container.querySelector('[aria-hidden="true"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder).toHaveClass('h-7');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lỗi tải (chưa có dữ liệu): nút "Thử lại" có tên truy cập là câu lỗi và gọi refetch', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mocks.query.current = { isPending: false, isError: true, refetch };
    renderButton();

    await user.click(screen.getByRole('button', { name: 'Không tải được thông tin kháng nghị.' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('canAppeal=true: nút "Kháng nghị" có tên truy cập kèm tên sản phẩm để phân biệt giữa nhiều dòng', () => {
    respondWith(makeShopAppeals({ canAppeal: true }));
    renderButton();

    const button = screen.getByRole('button', { name: 'Kháng nghị việc gỡ: Dao bấm tự động' });
    expect(button).toHaveTextContent('Kháng nghị');
  });

  it('kháng nghị gần nhất còn chờ: không còn nút, hiện dòng "Đã gửi kháng nghị, chờ Admin xem xét"', () => {
    respondWith(makeShopAppeals({ appeals: [makeOwnerAppeal()], canAppeal: false }));
    renderButton();

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Đã gửi kháng nghị, chờ Admin xem xét')).toBeInTheDocument();
  });

  it('kháng nghị gần nhất bị từ chối: hiện "Kháng nghị bị từ chối", không có nút', () => {
    respondWith(
      makeShopAppeals({
        appeals: [makeOwnerAppeal({ state: 'REJECTED', decisionNote: 'Chưa đủ' })],
        canAppeal: false,
      }),
    );
    renderButton();

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Kháng nghị bị từ chối')).toBeInTheDocument();
  });

  it('lấy kháng nghị MỚI NHẤT (đầu danh sách) để quyết định hiện gì: cũ bị từ chối nhưng mới đang chờ ⇒ "chờ"', () => {
    respondWith(
      makeShopAppeals({
        appeals: [
          makeOwnerAppeal({ id: 'new' }),
          makeOwnerAppeal({ id: 'old', state: 'REJECTED' }),
        ],
        canAppeal: false,
      }),
    );
    renderButton();

    expect(screen.getByText('Đã gửi kháng nghị, chờ Admin xem xét')).toBeInTheDocument();
    expect(screen.queryByText('Kháng nghị bị từ chối')).not.toBeInTheDocument();
  });

  it.each(['CLOSED', 'ACCEPTED'] as const)(
    'không kháng nghị được và kháng nghị gần nhất là %s ⇒ không vẽ gì',
    (state) => {
      respondWith(makeShopAppeals({ appeals: [makeOwnerAppeal({ state })], canAppeal: false }));
      renderButton();

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByText(/kháng nghị/i)).not.toBeInTheDocument();
    },
  );

  it('không kháng nghị được và chưa từng kháng nghị ⇒ không vẽ gì', () => {
    respondWith(makeShopAppeals({ appeals: [], canAppeal: false }));
    const { container } = renderButton();

    expect(container).toBeEmptyDOMElement();
  });

  it('bấm "Kháng nghị" mở hộp thoại của SẢN PHẨM; gửi thành công thì đóng, mutation nhận lời đã làm sạch', async () => {
    const user = userEvent.setup();
    mocks.mutateAsync.mockResolvedValue(makeOwnerAppeal());
    respondWith(makeShopAppeals({ canAppeal: true }));
    renderButton();

    await user.click(screen.getByRole('button', { name: /Kháng nghị việc gỡ/ }));
    expect(
      await screen.findByRole('heading', { name: 'Kháng nghị việc gỡ sản phẩm' }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Nội dung kháng nghị'), ' Xin xem xét ');
    await user.click(screen.getByRole('button', { name: 'Gửi kháng nghị' }));

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith('Xin xem xét'));
    await waitFor(() =>
      expect(screen.queryByLabelText('Nội dung kháng nghị')).not.toBeInTheDocument(),
    );
  });

  it('gửi lỗi 409: hộp thoại VẪN MỞ, hiện câu lỗi của sản phẩm và giữ chữ đã gõ', async () => {
    const user = userEvent.setup();
    mocks.mutateAsync.mockRejectedValue(new ApiError('x', 409, 'APPEAL_NOT_ALLOWED'));
    respondWith(makeShopAppeals({ canAppeal: true }));
    renderButton();

    await user.click(screen.getByRole('button', { name: /Kháng nghị việc gỡ/ }));
    await user.type(await screen.findByLabelText('Nội dung kháng nghị'), 'Xin xem xét');
    await user.click(screen.getByRole('button', { name: 'Gửi kháng nghị' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sản phẩm này hiện không thể gửi kháng nghị.',
    );
    expect((screen.getByLabelText('Nội dung kháng nghị') as HTMLTextAreaElement).value).toBe(
      'Xin xem xét',
    );
  });

  it('mở hộp thoại lại thì xoá lỗi của lần trước', async () => {
    const user = userEvent.setup();
    mocks.mutateAsync.mockRejectedValue(new ApiError('x', 409, 'APPEAL_ALREADY_SENT'));
    respondWith(makeShopAppeals({ canAppeal: true }));
    renderButton();
    await user.click(screen.getByRole('button', { name: /Kháng nghị việc gỡ/ }));
    await user.type(await screen.findByLabelText('Nội dung kháng nghị'), 'x');
    await user.click(screen.getByRole('button', { name: 'Gửi kháng nghị' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() =>
      expect(screen.queryByLabelText('Nội dung kháng nghị')).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: /Kháng nghị việc gỡ/ }));

    await screen.findByLabelText('Nội dung kháng nghị');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('đang gửi thì KHÔNG đóng được hộp thoại bằng Esc; xong thì đóng được', async () => {
    const user = userEvent.setup();
    respondWith(makeShopAppeals({ canAppeal: true }));
    // Tạo phần tử MỚI mỗi lần: dùng lại cùng một phần tử thì React bỏ qua lần render lại và không đọc cờ "đang gửi" mới.
    const view = () => (
      <ProductAppealButton shopId={SHOP_ID} productId={PRODUCT_ID} productName="Dao bấm tự động" />
    );
    const { rerender } = render(withIntl(view(), 'vi'));
    await user.click(screen.getByRole('button', { name: /Kháng nghị việc gỡ/ }));
    await screen.findByLabelText('Nội dung kháng nghị');

    mocks.isCreating.current = true;
    rerender(withIntl(view(), 'vi'));
    await user.keyboard('{Escape}');
    expect(screen.getByLabelText('Nội dung kháng nghị')).toBeInTheDocument();

    mocks.isCreating.current = false;
    rerender(withIntl(view(), 'vi'));
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByLabelText('Nội dung kháng nghị')).not.toBeInTheDocument(),
    );
  });

  it('tiếng Anh: nút và tên truy cập không lẫn tiếng Việt', () => {
    respondWith(makeShopAppeals({ canAppeal: true }));
    renderButton('en');

    expect(
      screen.getByRole('button', { name: 'Appeal the take-down of: Dao bấm tự động' }),
    ).toHaveTextContent('Appeal');
  });
});
