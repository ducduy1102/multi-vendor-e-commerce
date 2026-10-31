import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { makeOwnerAppeal, makeShopAppeals } from '../appeal.fixtures';
import { ProductAppealSection } from './ProductAppealSection';

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
  mutationArgs: vi.fn(),
}));

vi.mock('../hooks/useProductAppeals', () => ({
  useProductAppeals: (shopId: string, productId: string) => {
    mocks.queryArgs(shopId, productId);
    return mocks.query.current;
  },
}));
vi.mock('../hooks/useCreateProductAppeal', () => ({
  useCreateProductAppeal: (shopId: string, productId: string) => {
    mocks.mutationArgs(shopId, productId);
    return { mutateAsync: mocks.mutateAsync, isPending: mocks.isCreating.current };
  },
}));

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';

function renderSection(locale: 'vi' | 'en' = 'vi') {
  return render(withIntl(<ProductAppealSection shopId={SHOP_ID} productId={PRODUCT_ID} />, locale));
}

function respondWith(data: ReturnType<typeof makeShopAppeals>) {
  mocks.query.current = { data, isPending: false, isError: false, refetch: vi.fn() };
}

describe('ProductAppealSection', () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.isCreating.current = false;
    mocks.queryArgs.mockReset();
    mocks.mutationArgs.mockReset();
    mocks.query.current = { isPending: true, isError: false, refetch: vi.fn() };
  });

  afterEach(() => {
    cleanup();
  });

  it('nối hook của SẢN PHẨM với đúng shop và sản phẩm (không dùng hook của shop)', () => {
    respondWith(makeShopAppeals({ appeals: [], canAppeal: true }));
    renderSection();

    expect(mocks.queryArgs).toHaveBeenCalledWith(SHOP_ID, PRODUCT_ID);
    expect(mocks.mutationArgs).toHaveBeenCalledWith(SHOP_ID, PRODUCT_ID);
  });

  it('đang tải: vùng bận có chữ cho trình đọc màn hình, KHÔNG có nút gửi', () => {
    const { container } = renderSection();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Đang tải...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gửi kháng nghị' })).not.toBeInTheDocument();
  });

  it('lỗi tải (chưa có dữ liệu): báo lỗi + nút "Thử lại" gọi refetch', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mocks.query.current = { isPending: false, isError: true, refetch };
    renderSection();

    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được thông tin kháng nghị.');
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('không kháng nghị được và chưa từng kháng nghị ⇒ không vẽ gì', () => {
    respondWith(makeShopAppeals({ appeals: [], canAppeal: false }));
    const { container } = renderSection();

    expect(container).toBeEmptyDOMElement();
  });

  it('canAppeal=true: tiêu đề và mô tả nói về GỠ SẢN PHẨM (không phải khoá shop), có nút gửi', () => {
    respondWith(makeShopAppeals({ appeals: [], canAppeal: true }));
    renderSection();

    expect(
      screen.getByRole('heading', { name: 'Kháng nghị việc gỡ sản phẩm' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Mỗi lần bị gỡ chỉ gửi được một kháng nghị/)).toBeInTheDocument();
    expect(screen.queryByText(/khoá/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi kháng nghị' })).toBeInTheDocument();
  });

  it('đã kháng nghị (canAppeal=false): ẨN nút gửi và mô tả, chỉ còn lịch sử', () => {
    respondWith(makeShopAppeals({ appeals: [makeOwnerAppeal()], canAppeal: false }));
    renderSection();

    expect(screen.queryByRole('button', { name: 'Gửi kháng nghị' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Mỗi lần bị gỡ/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('list', { name: 'Lịch sử kháng nghị' }).querySelectorAll('li'),
    ).toHaveLength(1);
  });

  it('kháng nghị đã đóng nói "Lần gỡ này đã kết thúc" (không phải "Lần khoá này")', () => {
    respondWith(
      makeShopAppeals({ appeals: [makeOwnerAppeal({ state: 'CLOSED' })], canAppeal: false }),
    );
    renderSection();

    expect(screen.getByText('Lần gỡ này đã kết thúc.')).toBeInTheDocument();
    expect(screen.queryByText(/Lần khoá/)).not.toBeInTheDocument();
  });

  it('hộp thoại dùng lời văn của sản phẩm', async () => {
    const user = userEvent.setup();
    respondWith(makeShopAppeals({ appeals: [], canAppeal: true }));
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Gửi kháng nghị' }));

    expect(
      await screen.findByRole('heading', { name: 'Kháng nghị việc gỡ sản phẩm', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Giải thích vì sao sản phẩm nên được khôi phục/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Sản phẩm đã được bổ sung giấy tờ nguồn gốc/)).toBeTruthy();
  });

  it('gửi thành công: hộp thoại đóng và hiện thông báo thành công; mutation nhận lời đã làm sạch', async () => {
    const user = userEvent.setup();
    mocks.mutateAsync.mockResolvedValue(makeOwnerAppeal());
    respondWith(makeShopAppeals({ appeals: [], canAppeal: true }));
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Gửi kháng nghị' }));
    await user.type(await screen.findByLabelText('Nội dung kháng nghị'), ' Xin xem xét ');
    const buttons = screen.getAllByRole('button', { name: 'Gửi kháng nghị' });
    await user.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith('Xin xem xét'));
    expect(await screen.findByRole('status')).toHaveTextContent('Đã gửi kháng nghị.');
    await waitFor(() =>
      expect(screen.queryByLabelText('Nội dung kháng nghị')).not.toBeInTheDocument(),
    );
  });

  it.each([
    ['APPEAL_ALREADY_SENT', 'Bạn đã gửi kháng nghị cho lần gỡ này rồi.'],
    ['APPEAL_NOT_ALLOWED', 'Sản phẩm này hiện không thể gửi kháng nghị.'],
  ])(
    'gửi lỗi %s: hộp thoại VẪN MỞ, hiện câu lỗi của SẢN PHẨM và giữ chữ đã gõ — không báo thành công',
    async (code, message) => {
      const user = userEvent.setup();
      mocks.mutateAsync.mockRejectedValue(new ApiError('x', 409, code));
      respondWith(makeShopAppeals({ appeals: [], canAppeal: true }));
      renderSection();

      await user.click(screen.getByRole('button', { name: 'Gửi kháng nghị' }));
      await user.type(await screen.findByLabelText('Nội dung kháng nghị'), 'Xin xem xét');
      const buttons = screen.getAllByRole('button', { name: 'Gửi kháng nghị' });
      await user.click(buttons[buttons.length - 1]);

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.getByRole('alert')).not.toHaveTextContent(/khoá|Shop của bạn/);
      expect((screen.getByLabelText('Nội dung kháng nghị') as HTMLTextAreaElement).value).toBe(
        'Xin xem xét',
      );
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    },
  );

  it('đang gửi thì KHÔNG đóng được hộp thoại bằng Esc (tránh mất kết quả / gửi trùng); xong thì đóng được', async () => {
    const user = userEvent.setup();
    respondWith(makeShopAppeals({ appeals: [], canAppeal: true }));
    // Tạo phần tử MỚI mỗi lần: dùng lại cùng một phần tử thì React bỏ qua lần render lại và không đọc cờ "đang gửi" mới.
    const view = () => <ProductAppealSection shopId={SHOP_ID} productId={PRODUCT_ID} />;
    const { rerender } = render(withIntl(view(), 'vi'));
    await user.click(screen.getByRole('button', { name: 'Gửi kháng nghị' }));
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

  it('mở hộp thoại lại thì xoá lỗi của lần gửi trước (lỗi cũ không bám sang lần nhập mới)', async () => {
    const user = userEvent.setup();
    mocks.mutateAsync.mockRejectedValue(new ApiError('x', 409, 'APPEAL_ALREADY_SENT'));
    respondWith(makeShopAppeals({ appeals: [], canAppeal: true }));
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Gửi kháng nghị' }));
    await user.type(await screen.findByLabelText('Nội dung kháng nghị'), 'x');
    const buttons = screen.getAllByRole('button', { name: 'Gửi kháng nghị' });
    await user.click(buttons[buttons.length - 1]);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() =>
      expect(screen.queryByLabelText('Nội dung kháng nghị')).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Gửi kháng nghị' }));

    await screen.findByLabelText('Nội dung kháng nghị');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mở lại hộp thoại sau khi đã gửi thành công thì ẩn thông báo "Đã gửi" của lần trước', async () => {
    const user = userEvent.setup();
    mocks.mutateAsync.mockResolvedValue(makeOwnerAppeal());
    respondWith(makeShopAppeals({ appeals: [], canAppeal: true }));
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Gửi kháng nghị' }));
    await user.type(await screen.findByLabelText('Nội dung kháng nghị'), 'x');
    const buttons = screen.getAllByRole('button', { name: 'Gửi kháng nghị' });
    await user.click(buttons[buttons.length - 1]);
    expect(await screen.findByRole('status')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Gửi kháng nghị' }));

    await screen.findByLabelText('Nội dung kháng nghị');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('tiếng Anh: không lẫn chuỗi tiếng Việt', () => {
    respondWith(
      makeShopAppeals({
        appeals: [makeOwnerAppeal({ state: 'CLOSED', message: 'We added proof.' })],
        canAppeal: true,
      }),
    );
    renderSection('en');

    expect(screen.getByRole('heading', { name: 'Appeal the take-down' })).toBeInTheDocument();
    expect(screen.getByText('That take-down has ended.')).toBeInTheDocument();
    const vietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    const withoutUserText = (document.body.textContent ?? '').replace('We added proof.', '');
    expect(withoutUserText).not.toMatch(vietnamese);
  });
});
