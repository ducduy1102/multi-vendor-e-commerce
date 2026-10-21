import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { CONVERSATION_ID, SHOP_ID, makeSummary } from '../chat-test-data';
import * as chatService from '../services/chat.service';
import { ShopChatButton } from './ShopChatButton';

const { push, pathname } = vi.hoisted(() => ({ push: vi.fn(), pathname: vi.fn() }));

// Giữ Link thật của next-intl; chỉ thay router (không có app router trong test) và pathname.
vi.mock('@/i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/navigation')>()),
  useRouter: () => ({ push }),
  usePathname: () => pathname(),
}));
vi.mock('../services/chat.service');

const openConversationMock = vi.mocked(chatService.openConversation);

function setup(props: { isAuthenticated: boolean; isOwnShop?: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {withIntl(<ShopChatButton shopId={SHOP_ID} {...props} />)}
    </QueryClientProvider>,
  );
}

describe('ShopChatButton', () => {
  beforeEach(() => {
    push.mockReset();
    pathname.mockReset().mockReturnValue('/shops/ao-xinh');
    openConversationMock.mockReset();
  });
  afterEach(() => cleanup());

  describe('khách vãng lai', () => {
    it('là LINK tới /login?next=<trang hiện tại> (không gọi API, không có nút bấm)', () => {
      setup({ isAuthenticated: false });

      const link = screen.getByRole('link', { name: 'Chat với shop' });
      expect(link).toHaveAttribute('href', `/login?next=${encodeURIComponent('/shops/ao-xinh')}`);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(openConversationMock).not.toHaveBeenCalled();
    });

    it('trang có query vẫn quay lại đúng trang: next được mã hoá', () => {
      pathname.mockReturnValue('/orders/3f6c1e4a-9b1d-4c1e-8a55-0d2c4f5a6b7c');
      setup({ isAuthenticated: false });

      expect(screen.getByRole('link', { name: 'Chat với shop' })).toHaveAttribute(
        'href',
        '/login?next=%2Forders%2F3f6c1e4a-9b1d-4c1e-8a55-0d2c4f5a6b7c',
      );
    });
  });

  describe('chủ shop đang xem shop của chính mình', () => {
    it.each([true, false])('ẩn hẳn nút (đăng nhập=%s)', (isAuthenticated) => {
      const { container } = setup({ isAuthenticated, isOwnShop: true });

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('đã đăng nhập', () => {
    it('bấm ⇒ mở hội thoại theo shopId rồi chuyển sang /chat?c=<id>', async () => {
      const user = userEvent.setup();
      openConversationMock.mockResolvedValue(makeSummary({ id: CONVERSATION_ID }));
      setup({ isAuthenticated: true });

      await user.click(screen.getByRole('button', { name: 'Chat với shop' }));

      await waitFor(() => expect(push).toHaveBeenCalledWith(`/chat?c=${CONVERSATION_ID}`));
      expect(openConversationMock).toHaveBeenCalledWith(SHOP_ID);
    });

    it('đang mở: nút tắt, đổi chữ và aria-busy — bấm lặp không gọi API lần hai', async () => {
      const user = userEvent.setup();
      openConversationMock.mockReturnValue(new Promise(() => {}));
      setup({ isAuthenticated: true });

      await user.click(screen.getByRole('button', { name: 'Chat với shop' }));

      const pending = await screen.findByRole('button', { name: 'Đang mở...' });
      expect(pending).toBeDisabled();
      expect(pending).toHaveAttribute('aria-busy', 'true');
      await user.click(pending);
      expect(openConversationMock).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
    });

    it.each([
      [409, 'CHAT_OWN_SHOP', 'Bạn không thể nhắn tin cho shop của chính mình'],
      [
        429,
        'CHAT_CONVERSATION_LIMIT',
        'Hôm nay bạn đã mở quá nhiều cuộc trò chuyện, vui lòng thử lại sau',
      ],
      [403, 'EMAIL_NOT_VERIFIED', 'Email của bạn chưa được xác thực'],
    ])('lỗi %i %s ⇒ câu đã dịch ngay dưới nút, không chuyển trang', async (status, code, text) => {
      const user = userEvent.setup();
      openConversationMock.mockRejectedValue(new ApiError('tiếng Anh của BE', status, code));
      setup({ isAuthenticated: true });

      await user.click(screen.getByRole('button', { name: 'Chat với shop' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(text);
      expect(alert).not.toHaveTextContent('tiếng Anh của BE');
      expect(push).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Chat với shop' })).toBeEnabled();
    });

    it('mất mạng ⇒ câu mất kết nối chung; lỗi lạ ⇒ câu "không mở được"', async () => {
      const user = userEvent.setup();
      openConversationMock.mockRejectedValueOnce(new ApiError('x', 0));
      setup({ isAuthenticated: true });
      await user.click(screen.getByRole('button', { name: 'Chat với shop' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Mất kết nối mạng, vui lòng kiểm tra và thử lại',
      );

      openConversationMock.mockRejectedValueOnce(new ApiError('x', 500));
      await user.click(screen.getByRole('button', { name: 'Chat với shop' }));
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Không mở được cuộc trò chuyện, vui lòng thử lại.',
        ),
      );
    });

    it('thử lại sau lỗi được và thành công thì chuyển trang', async () => {
      const user = userEvent.setup();
      openConversationMock.mockRejectedValueOnce(new ApiError('x', 500));
      openConversationMock.mockResolvedValueOnce(makeSummary({ id: CONVERSATION_ID }));
      setup({ isAuthenticated: true });

      await user.click(screen.getByRole('button', { name: 'Chat với shop' }));
      await screen.findByRole('alert');
      await user.click(screen.getByRole('button', { name: 'Chat với shop' }));

      await waitFor(() => expect(push).toHaveBeenCalledWith(`/chat?c=${CONVERSATION_ID}`));
    });
  });
});
