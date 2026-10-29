import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { makeOwnerAppeal, makeShopAppeals } from '../appeal.fixtures';
import { ShopAppealSection } from './ShopAppealSection';

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
}));

vi.mock('../hooks/useShopAppeals', () => ({ useShopAppeals: () => mocks.query.current }));
vi.mock('../hooks/useCreateShopAppeal', () => ({
  useCreateShopAppeal: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));

const SHOP_ID = '11111111-1111-4111-8111-111111111111';

function renderSection() {
  return render(withIntl(<ShopAppealSection shopId={SHOP_ID} />));
}

function respondWith(data: ReturnType<typeof makeShopAppeals>) {
  mocks.query.current = { data, isPending: false, isError: false, refetch: vi.fn() };
}

describe('ShopAppealSection', () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.query.current = { isPending: true, isError: false, refetch: vi.fn() };
  });

  afterEach(() => {
    cleanup();
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

  it('không kháng nghị được và chưa từng kháng nghị (vd khoá theo cascade) ⇒ không vẽ gì', () => {
    respondWith(makeShopAppeals({ appeals: [], canAppeal: false }));

    const { container } = renderSection();

    expect(container).toBeEmptyDOMElement();
  });

  it('canAppeal=true: có mô tả và nút gửi; chưa có lịch sử nên không có danh sách', () => {
    respondWith(makeShopAppeals({ appeals: [], canAppeal: true }));
    renderSection();

    expect(screen.getByRole('heading', { name: 'Kháng nghị' })).toBeInTheDocument();
    expect(screen.getByText(/Mỗi lần bị khoá chỉ gửi được một kháng nghị/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi kháng nghị' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Lịch sử kháng nghị' })).not.toBeInTheDocument();
  });

  it('đã kháng nghị (canAppeal=false): ẨN nút gửi và mô tả, chỉ còn lịch sử', () => {
    respondWith(makeShopAppeals({ appeals: [makeOwnerAppeal()], canAppeal: false }));
    renderSection();

    expect(screen.queryByRole('button', { name: 'Gửi kháng nghị' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Mỗi lần bị khoá/)).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Lịch sử kháng nghị' });
    expect(list.querySelectorAll('li')).toHaveLength(1);
  });

  it('lịch sử giữ nguyên thứ tự BE trả (mới nhất trước)', () => {
    respondWith(
      makeShopAppeals({
        appeals: [
          makeOwnerAppeal({ id: 'b', message: 'Kháng nghị mới' }),
          makeOwnerAppeal({ id: 'a', message: 'Kháng nghị cũ', state: 'CLOSED' }),
        ],
        canAppeal: false,
      }),
    );
    renderSection();

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Kháng nghị mới');
    expect(items[1]).toHaveTextContent('Kháng nghị cũ');
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

  it('gửi lỗi theo mã nghiệp vụ: hộp thoại VẪN MỞ, hiện câu lỗi đã dịch và giữ chữ đã gõ — không báo thành công', async () => {
    const user = userEvent.setup();
    mocks.mutateAsync.mockRejectedValue(new ApiError('x', 409, 'APPEAL_ALREADY_SENT'));
    respondWith(makeShopAppeals({ appeals: [], canAppeal: true }));
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Gửi kháng nghị' }));
    await user.type(await screen.findByLabelText('Nội dung kháng nghị'), 'Xin xem xét');
    const buttons = screen.getAllByRole('button', { name: 'Gửi kháng nghị' });
    await user.click(buttons[buttons.length - 1]);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bạn đã gửi kháng nghị cho lần khoá này rồi.',
    );
    expect((screen.getByLabelText('Nội dung kháng nghị') as HTMLTextAreaElement).value).toBe(
      'Xin xem xét',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
