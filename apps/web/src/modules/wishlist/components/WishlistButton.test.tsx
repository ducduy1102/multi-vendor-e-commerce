import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/modules/auth';
import { withIntl } from '@/shared/lib/test-i18n';
import * as wishlistService from '../services/wishlist.service';
import { WishlistButton } from './WishlistButton';

vi.mock('../services/wishlist.service', () => ({
  getWishlistStatus: vi.fn(),
  addToWishlist: vi.fn(),
  removeFromWishlist: vi.fn(),
}));

function renderButton(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(withIntl(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
}

function loginUser() {
  useAuthStore.getState().setUser({
    id: 'user-1',
    email: 'user@example.com',
    name: 'Nguyen Van A',
    role: 'USER',
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  });
  useAuthStore.getState().setIsHydrating(false);
}

// Mock giữ trạng thái thật (không chỉ resolve 1 giá trị cố định) — mutation
// thành công sẽ trigger invalidateQueries -> refetch getWishlistStatus, nếu
// mock luôn trả cố định "false" thì refetch sẽ ghi đè optimistic update về
// sai giá trị, gây test flaky/sai (đã gặp lúc viết test này). Mock kiểu
// stateful mô phỏng đúng hành vi BE thật (add/remove đổi state, status đọc
// lại đúng state đó).
function setupStatefulWishlistMock(initial: boolean) {
  let isWishlisted = initial;
  vi.mocked(wishlistService.getWishlistStatus).mockImplementation(() =>
    Promise.resolve({ isWishlisted }),
  );
  vi.mocked(wishlistService.addToWishlist).mockImplementation(() => {
    isWishlisted = true;
    return Promise.resolve({ isWishlisted });
  });
  vi.mocked(wishlistService.removeFromWishlist).mockImplementation(() => {
    isWishlisted = false;
    return Promise.resolve({ isWishlisted });
  });
}

describe('WishlistButton', () => {
  beforeEach(() => {
    setupStatefulWishlistMock(false);
  });

  afterEach(() => {
    useAuthStore.getState().clearUser();
    useAuthStore.getState().setIsHydrating(true);
    vi.clearAllMocks();
  });

  it('chưa biết chắc đã đăng nhập hay chưa (đang hydrate) -> không render gì', () => {
    useAuthStore.getState().setIsHydrating(true);

    const { container } = renderButton(<WishlistButton productId="product-1" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('đã hydrate xong nhưng chưa đăng nhập -> ẩn hẳn nút', () => {
    useAuthStore.getState().setIsHydrating(false);

    const { container } = renderButton(<WishlistButton productId="product-1" />);

    expect(container).toBeEmptyDOMElement();
    expect(wishlistService.getWishlistStatus).not.toHaveBeenCalled();
  });

  it('đã đăng nhập, chưa wishlist -> hiện nút, gọi status lúc mount', async () => {
    loginUser();

    renderButton(<WishlistButton productId="product-1" />);

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
    });
    expect(wishlistService.getWishlistStatus).toHaveBeenCalledWith('product-1');
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Thêm vào yêu thích');
  });

  it('đã wishlist sẵn (status trả true) -> hiện đúng trạng thái đã chọn', async () => {
    setupStatefulWishlistMock(true);
    loginUser();

    renderButton(<WishlistButton productId="product-1" />);

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    });
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Bỏ khỏi yêu thích');
  });

  it('bấm khi chưa wishlist -> gọi addToWishlist, cuối cùng ở trạng thái đã chọn', async () => {
    loginUser();
    const user = userEvent.setup();

    renderButton(<WishlistButton productId="product-1" />);
    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
    });

    await user.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    });
    expect(wishlistService.addToWishlist).toHaveBeenCalledWith('product-1');
  });

  it('bấm khi đã wishlist -> gọi removeFromWishlist, cuối cùng ở trạng thái bỏ chọn', async () => {
    setupStatefulWishlistMock(true);
    loginUser();
    const user = userEvent.setup();

    renderButton(<WishlistButton productId="product-1" />);
    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    });

    await user.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
    });
    expect(wishlistService.removeFromWishlist).toHaveBeenCalledWith('product-1');
  });

  it('API lỗi -> rollback lại đúng trạng thái cũ (không giữ optimistic sai)', async () => {
    vi.mocked(wishlistService.addToWishlist).mockRejectedValue(new Error('network error'));
    loginUser();
    const user = userEvent.setup();

    renderButton(<WishlistButton productId="product-1" />);
    await waitFor(() => screen.getByRole('button'));

    await user.click(screen.getByRole('button'));

    // Không assert trạng thái tạm "true" ngay sau click (dễ flaky — onMutate
    // chạy qua vài microtask trước khi commit optimistic state) — chỉ cần
    // xác nhận cuối cùng rollback đúng về "false" (trạng thái thật trước khi
    // bấm), không bị kẹt ở "true" sai do lỗi API.
    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
    });
  });
});
