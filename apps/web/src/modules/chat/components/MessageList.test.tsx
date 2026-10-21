import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { CONVERSATION_ID, makeMessage, uuid } from '../chat-test-data';
import type { ChatMessageView } from '../hooks/chat-messages';
import { MessageList } from './MessageList';

// jsdom không có layout nên không tự tính scrollHeight/clientHeight/scrollTop. Dựng số đo giả trên prototype (mỗi
// phần tử có scrollTop riêng, ghi được) để kiểm đúng logic cuộn — kết quả layout THẬT kiểm bằng Playwright.
const metrics = { scrollHeight: 1000, clientHeight: 300 };
const positions = new WeakMap<Element, number>();
const originals: Record<string, PropertyDescriptor | undefined> = {};

function mockLayout() {
  for (const name of ['scrollHeight', 'clientHeight', 'scrollTop']) {
    originals[name] = Object.getOwnPropertyDescriptor(Element.prototype, name);
  }
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get: () => metrics.clientHeight,
  });
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return positions.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      positions.set(this, value);
    },
  });
}

function restoreLayout() {
  for (const name of ['scrollHeight', 'clientHeight', 'scrollTop']) {
    const original = originals[name];
    if (original) Object.defineProperty(Element.prototype, name, original);
    else delete (Element.prototype as unknown as Record<string, unknown>)[name];
  }
}

const NOW = new Date(2030, 0, 10, 15, 0, 0).getTime();
const local = (day: number, hour: number, minute = 0) => new Date(2030, 0, day, hour, minute, 0);

let counter = 0;
const message = (
  createdAt: Date,
  senderRole: 'BUYER' | 'SHOP' = 'SHOP',
  overrides: Partial<ChatMessageView> = {},
): ChatMessageView => ({
  ...makeMessage({
    id: uuid(++counter),
    conversationId: CONVERSATION_ID,
    senderRole,
    content: `tin ${counter}`,
    createdAt: createdAt.toISOString(),
  }),
  ...overrides,
});

interface Props {
  items: ChatMessageView[];
  viewerRole?: 'BUYER' | 'SHOP';
  otherLastReadAt?: string | null;
  hasOlder?: boolean;
  isFetchingOlder?: boolean;
  onFetchOlder?: () => void;
}

function list(props: Props): ReactElement {
  return withIntl(
    <MessageList
      items={props.items}
      viewerRole={props.viewerRole ?? 'BUYER'}
      counterpartName="Shop Áo"
      otherLastReadAt={props.otherLastReadAt ?? null}
      hasOlder={props.hasOlder ?? false}
      isFetchingOlder={props.isFetchingOlder ?? false}
      now={NOW}
      describeFailure={() => 'lỗi'}
      onFetchOlder={props.onFetchOlder ?? vi.fn()}
      onRetry={vi.fn()}
      onDiscard={vi.fn()}
    />,
  );
}

const scroller = () => screen.getByLabelText('Cuộc trò chuyện');
const liveRegion = () => screen.getByRole('status');
const scrollTo = (top: number) => {
  positions.set(scroller(), top);
  fireEvent.scroll(scroller());
};

describe('MessageList', () => {
  beforeEach(() => {
    metrics.scrollHeight = 1000;
    metrics.clientHeight = 300;
    mockLayout();
  });
  afterEach(() => {
    restoreLayout();
  });

  describe('hiển thị', () => {
    it('đảo MỚI NHẤT trước thành cũ → mới, có dải ngày "Hôm nay"/"Hôm qua" theo giờ địa phương', () => {
      const yesterday = message(local(9, 20));
      const today1 = message(local(10, 9));
      const today2 = message(local(10, 10), 'BUYER');

      render(list({ items: [today2, today1, yesterday] }));

      expect(screen.getByText('Hôm qua')).toBeInTheDocument();
      expect(screen.getByText('Hôm nay')).toBeInTheDocument();
      const texts = screen
        .getAllByRole('listitem')
        .map((item) => item.textContent?.replace(/^(Bạn|Shop Áo): /, ''));
      expect(texts[0]).toContain(yesterday.content);
      expect(texts[2]).toContain(today2.content);
    });

    it('ngày xa hơn hiện ngày tháng đầy đủ thay vì "Hôm nay/Hôm qua"', () => {
      render(list({ items: [message(local(2, 9))] }));

      expect(screen.queryByText('Hôm nay')).not.toBeInTheDocument();
      expect(screen.queryByText('Hôm qua')).not.toBeInTheDocument();
      expect(screen.getByText(/02\/01\/2030/)).toBeInTheDocument();
    });

    it('"Đã xem" chỉ ở tin CUỐI của mình mà đối phương đã đọc tới — không lặp ở các tin cũ hơn', () => {
      const mineOld = message(local(10, 9, 0), 'BUYER');
      const mineSeen = message(local(10, 9, 10), 'BUYER');
      const theirs = message(local(10, 9, 20), 'SHOP');
      const mineUnseen = message(local(10, 9, 30), 'BUYER');

      render(
        list({
          items: [mineUnseen, theirs, mineSeen, mineOld],
          otherLastReadAt: mineSeen.createdAt,
        }),
      );

      expect(screen.getAllByText('Đã xem')).toHaveLength(1);
      const seenItem = screen.getByText('Đã xem').closest('li');
      expect(seenItem).toHaveTextContent(mineSeen.content);
    });

    it('chưa biết mốc đọc ⇒ không có "Đã xem"', () => {
      render(list({ items: [message(local(10, 9), 'BUYER')], otherLastReadAt: null }));

      expect(screen.queryByText('Đã xem')).not.toBeInTheDocument();
    });

    it('"Tải tin cũ hơn" chỉ khi còn tin cũ; bấm gọi onFetchOlder; đang tải thì tắt và đổi chữ', async () => {
      const user = userEvent.setup();
      const onFetchOlder = vi.fn();
      const view = render(list({ items: [message(local(10, 9))], onFetchOlder }));
      expect(screen.queryByRole('button', { name: 'Tải tin cũ hơn' })).not.toBeInTheDocument();

      view.rerender(list({ items: [message(local(10, 9))], hasOlder: true, onFetchOlder }));
      await user.click(screen.getByRole('button', { name: 'Tải tin cũ hơn' }));
      expect(onFetchOlder).toHaveBeenCalledTimes(1);

      view.rerender(
        list({
          items: [message(local(10, 9))],
          hasOlder: true,
          isFetchingOlder: true,
          onFetchOlder,
        }),
      );
      expect(screen.getByRole('button', { name: 'Đang tải...' })).toBeDisabled();
    });

    it('khung cuộn focus được bằng bàn phím và có nhãn (vùng cuộn phải truy cập được)', () => {
      render(list({ items: [message(local(10, 9))] }));

      expect(scroller()).toHaveAttribute('tabindex', '0');
    });
  });

  describe('cuộn', () => {
    it('lần đầu có tin: xuống đáy', () => {
      render(list({ items: [message(local(10, 9))] }));

      expect(positions.get(scroller())).toBe(1000);
    });

    it('tin mới của đối phương khi đang Ở GẦN ĐÁY: tự cuộn xuống, không hiện chip', () => {
      const first = message(local(10, 9));
      const view = render(list({ items: [first] }));
      scrollTo(650); // 1000 - 650 - 300 = 50 ≤ 80: vẫn gần đáy

      metrics.scrollHeight = 1100;
      view.rerender(list({ items: [message(local(10, 10)), first] }));

      expect(positions.get(scroller())).toBe(1100);
      expect(screen.queryByRole('button', { name: 'Tin mới' })).not.toBeInTheDocument();
    });

    it('tin mới của đối phương khi đang ĐỌC PHÍA TRÊN: KHÔNG giật khung, hiện chip "Tin mới"; bấm chip xuống đáy', async () => {
      const user = userEvent.setup();
      const first = message(local(10, 9));
      const view = render(list({ items: [first] }));
      scrollTo(100); // xa đáy

      metrics.scrollHeight = 1100;
      view.rerender(list({ items: [message(local(10, 10)), first] }));

      expect(positions.get(scroller())).toBe(100);
      const chip = screen.getByRole('button', { name: 'Tin mới' });

      await user.click(chip);
      expect(positions.get(scroller())).toBe(1100);
      // Trình duyệt phát sự kiện scroll sau khi cuộn: tới đáy ⇒ hết chip.
      fireEvent.scroll(scroller());
      expect(screen.queryByRole('button', { name: 'Tin mới' })).not.toBeInTheDocument();
    });

    it('cuộn xuống tay tới đáy cũng xoá chip', () => {
      const first = message(local(10, 9));
      const view = render(list({ items: [first] }));
      scrollTo(100);
      metrics.scrollHeight = 1100;
      view.rerender(list({ items: [message(local(10, 10)), first] }));
      expect(screen.getByRole('button', { name: 'Tin mới' })).toBeInTheDocument();

      scrollTo(800); // 1100 - 800 - 300 = 0

      expect(screen.queryByRole('button', { name: 'Tin mới' })).not.toBeInTheDocument();
    });

    it('tin do CHÍNH MÌNH gửi luôn cuộn xuống đáy, kể cả khi đang đọc phía trên, và không hiện chip', () => {
      const first = message(local(10, 9));
      const view = render(list({ items: [first] }));
      scrollTo(100);

      metrics.scrollHeight = 1100;
      view.rerender(
        list({
          items: [
            message(local(10, 10), 'BUYER', { id: 'pending:abc', deliveryStatus: 'sending' }),
            first,
          ],
        }),
      );

      expect(positions.get(scroller())).toBe(1100);
      expect(screen.queryByRole('button', { name: 'Tin mới' })).not.toBeInTheDocument();
    });

    it('tải tin cũ hơn: chèn lên đầu nhưng GIỮ chỗ đang đọc (bù đúng phần cao thêm vào)', async () => {
      const user = userEvent.setup();
      const newer = message(local(10, 10));
      const older = message(local(10, 9));
      const view = render(list({ items: [newer], hasOlder: true }));
      scrollTo(0);

      await user.click(screen.getByRole('button', { name: 'Tải tin cũ hơn' }));
      metrics.scrollHeight = 1400; // 400px tin cũ chèn lên đầu
      view.rerender(list({ items: [newer, older], hasOlder: false }));

      expect(positions.get(scroller())).toBe(400);
    });

    it('tin cũ về mà không do bấm "Tải tin cũ hơn" (vd làm mới) thì không xê dịch khung', () => {
      const newer = message(local(10, 10));
      const older = message(local(10, 9));
      const view = render(list({ items: [newer] }));
      scrollTo(120);

      metrics.scrollHeight = 1400;
      view.rerender(list({ items: [newer, older] }));

      expect(positions.get(scroller())).toBe(120);
    });
  });

  describe('thông báo cho trình đọc màn hình (aria-live)', () => {
    it('lần nạp đầu KHÔNG được đọc (vùng live trống)', () => {
      render(list({ items: [message(local(10, 9)), message(local(10, 8))] }));

      expect(liveRegion()).toHaveAttribute('aria-live', 'polite');
      expect(liveRegion()).toHaveTextContent('');
    });

    it('khung mount RỖNG rồi nhận lô tin đầu tiên: cũng là lần nạp đầu, không được đọc to', () => {
      const view = render(list({ items: [] }));

      view.rerender(list({ items: [message(local(10, 10)), message(local(10, 9))] }));

      expect(liveRegion()).toHaveTextContent('');
    });

    it('tin mới của đối phương được đọc: tên + nội dung; chỉ MỘT tin mới nhất, không đọc lại cả khung', () => {
      const first = message(local(10, 9));
      const view = render(list({ items: [first] }));

      const incoming = message(local(10, 10), 'SHOP', { content: 'Còn hàng nhé bạn' });
      view.rerender(list({ items: [incoming, first] }));

      expect(liveRegion()).toHaveTextContent('Tin nhắn mới từ Shop Áo: Còn hàng nhé bạn');
    });

    it('tin của chính mình không được đọc', () => {
      const first = message(local(10, 9));
      const view = render(list({ items: [first] }));

      view.rerender(list({ items: [message(local(10, 10), 'BUYER'), first] }));

      expect(liveRegion()).toHaveTextContent('');
    });

    it('tải tin cũ hơn (đầu danh sách đổi, tin mới nhất giữ nguyên) không được đọc', () => {
      const newer = message(local(10, 10));
      const view = render(list({ items: [newer] }));

      view.rerender(list({ items: [newer, message(local(10, 9))] }));

      expect(liveRegion()).toHaveTextContent('');
    });

    it('tin dài được rút gọn trong thông báo', () => {
      const first = message(local(10, 9));
      const view = render(list({ items: [first] }));

      view.rerender(
        list({ items: [message(local(10, 10), 'SHOP', { content: 'x'.repeat(500) }), first] }),
      );

      expect(liveRegion().textContent?.length ?? 0).toBeLessThan(200);
    });
  });

  it('ca xấu nhất: tin 1000 ký tự liền không dấu cách vẫn render (chặn tràn do class bẻ chữ kiểm ở trình duyệt thật)', () => {
    const longText = 'a'.repeat(1000);
    render(list({ items: [message(local(10, 9), 'BUYER', { content: longText })] }));

    expect(screen.getByText(longText, { exact: false })).toBeInTheDocument();
    act(() => {});
  });
});
