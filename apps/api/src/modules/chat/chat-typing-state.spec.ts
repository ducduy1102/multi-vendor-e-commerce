import {
  CHAT_TYPING_CACHE_MAX,
  CHAT_TYPING_FLOOD_MAX_EVENTS,
  CHAT_TYPING_FLOOD_WINDOW_MS,
  CHAT_TYPING_MEMBER_TTL_MS,
  CHAT_TYPING_MIN_INTERVAL_MS,
  CHAT_TYPING_NON_MEMBER_TTL_MS,
} from './chat-config';
import { SocketTypingState } from './chat-typing-state';

describe('SocketTypingState', () => {
  let now: number;
  let state: SocketTypingState;
  const advance = (ms: number) => {
    now += ms;
  };

  beforeEach(() => {
    now = 1_000_000;
    state = new SocketTypingState(() => now);
  });

  describe('withinFloodLimit', () => {
    it(`cho ${CHAT_TYPING_FLOOD_MAX_EVENTS} sự kiện đầu, từ chối sự kiện kế tiếp`, () => {
      const results = Array.from(
        { length: CHAT_TYPING_FLOOD_MAX_EVENTS + 1 },
        () => state.withinFloodLimit(),
      );

      expect(results.slice(0, CHAT_TYPING_FLOOD_MAX_EVENTS)).toEqual(
        Array<boolean>(CHAT_TYPING_FLOOD_MAX_EVENTS).fill(true),
      );
      expect(results[CHAT_TYPING_FLOOD_MAX_EVENTS]).toBe(false);
    });

    it('cửa sổ trượt: hết cửa sổ thì cho lại, còn thiếu 1ms thì chưa', () => {
      for (let i = 0; i < CHAT_TYPING_FLOOD_MAX_EVENTS; i++) {
        state.withinFloodLimit();
      }

      advance(CHAT_TYPING_FLOOD_WINDOW_MS - 1);
      expect(state.withinFloodLimit()).toBe(false);
      advance(1);
      expect(state.withinFloodLimit()).toBe(true);
    });

    it('sự kiện bị TỪ CHỐI không được ghi lại: gửi bừa trong lúc bị chặn không kéo dài thời gian bị chặn', () => {
      for (let i = 0; i < CHAT_TYPING_FLOOD_MAX_EVENTS; i++) {
        state.withinFloodLimit();
      }
      // cố gắng liên tục trong suốt cửa sổ
      for (let t = 0; t < CHAT_TYPING_FLOOD_WINDOW_MS - 1_000; t += 1_000) {
        advance(1_000);
        expect(state.withinFloodLimit()).toBe(false);
      }

      advance(1_000);

      expect(state.withinFloodLimit()).toBe(true);
    });

    it('trượt từng phần: chỉ các sự kiện cũ ra khỏi cửa sổ mới trả lại chỗ', () => {
      const half = CHAT_TYPING_FLOOD_MAX_EVENTS / 2;
      for (let i = 0; i < half; i++) state.withinFloodLimit();
      advance(CHAT_TYPING_FLOOD_WINDOW_MS / 2);
      for (let i = 0; i < half; i++) state.withinFloodLimit();
      expect(state.withinFloodLimit()).toBe(false);

      advance(CHAT_TYPING_FLOOD_WINDOW_MS / 2); // nửa đầu ra khỏi cửa sổ

      const allowed = Array.from({ length: half + 1 }, () =>
        state.withinFloodLimit(),
      );
      expect(allowed.filter(Boolean)).toHaveLength(half);
    });
  });

  describe('claimSlot', () => {
    it('lần đầu được; lần sau trong khoảng tối thiểu bị bỏ; đúng hết khoảng thì được', () => {
      expect(state.claimSlot('c1')).toBe(true);

      advance(CHAT_TYPING_MIN_INTERVAL_MS - 1);
      expect(state.claimSlot('c1')).toBe(false);
      advance(1);
      expect(state.claimSlot('c1')).toBe(true);
    });

    it('khoảng được tính từ lần ĐƯỢC NHẬN gần nhất, không phải từ lần bị từ chối', () => {
      state.claimSlot('c1'); // t = 0
      advance(1_500);
      expect(state.claimSlot('c1')).toBe(false); // bị từ chối, không làm mới
      advance(500); // t = 2000 kể từ lần được nhận

      expect(state.claimSlot('c1')).toBe(true);
    });

    it('mỗi hội thoại có khoảng riêng', () => {
      expect(state.claimSlot('c1')).toBe(true);
      expect(state.claimSlot('c2')).toBe(true);
      expect(state.claimSlot('c1')).toBe(false);
      expect(state.claimSlot('c2')).toBe(false);
    });

    it('bộ nhớ có trần: nhớ quá CHAT_TYPING_CACHE_MAX hội thoại thì quên cái CŨ NHẤT', () => {
      for (let i = 0; i <= CHAT_TYPING_CACHE_MAX; i++) state.claimSlot(`c${i}`);

      expect(state.claimSlot('c0')).toBe(true); // đã bị quên
      expect(state.claimSlot(`c${CHAT_TYPING_CACHE_MAX}`)).toBe(false); // mới nhất còn nhớ
    });
  });

  describe('recall / remember', () => {
    it('chưa biết ⇒ undefined', () => {
      expect(state.recall('c1')).toBeUndefined();
    });

    it('nhớ người nhận của thành viên và nhớ "không phải thành viên" (null)', () => {
      state.remember('c1', 'user-2');
      state.remember('c2', null);

      expect(state.recall('c1')).toEqual({ recipientId: 'user-2' });
      expect(state.recall('c2')).toEqual({ recipientId: null });
    });

    it('thành viên: nhớ đúng CHAT_TYPING_MEMBER_TTL_MS rồi quên', () => {
      state.remember('c1', 'user-2');

      advance(CHAT_TYPING_MEMBER_TTL_MS - 1);
      expect(state.recall('c1')).toEqual({ recipientId: 'user-2' });
      advance(1);
      expect(state.recall('c1')).toBeUndefined();
    });

    it('không phải thành viên: nhớ NGẮN hơn (hội thoại mới tạo không bị từ chối quá lâu)', () => {
      expect(CHAT_TYPING_NON_MEMBER_TTL_MS).toBeLessThan(
        CHAT_TYPING_MEMBER_TTL_MS,
      );
      state.remember('c1', null);

      advance(CHAT_TYPING_NON_MEMBER_TTL_MS - 1);
      expect(state.recall('c1')).toEqual({ recipientId: null });
      advance(1);
      expect(state.recall('c1')).toBeUndefined();
    });

    it('nhớ lại cùng hội thoại làm mới hạn và đổi giá trị', () => {
      state.remember('c1', null);
      advance(CHAT_TYPING_NON_MEMBER_TTL_MS - 1);

      state.remember('c1', 'user-2');
      advance(CHAT_TYPING_NON_MEMBER_TTL_MS);

      expect(state.recall('c1')).toEqual({ recipientId: 'user-2' });
    });

    it('bộ nhớ có trần: quá CHAT_TYPING_CACHE_MAX thì quên cái CŨ NHẤT, cái vừa làm mới thì giữ', () => {
      for (let i = 0; i < CHAT_TYPING_CACHE_MAX; i++) {
        state.remember(`c${i}`, `u${i}`);
      }
      state.remember('c0', 'u0-again'); // làm mới ⇒ không còn là cũ nhất
      state.remember('overflow', 'u-new');

      expect(state.recall('c1')).toBeUndefined();
      expect(state.recall('c0')).toEqual({ recipientId: 'u0-again' });
      expect(state.recall('overflow')).toEqual({ recipientId: 'u-new' });
    });
  });

  it('hai socket (hai bản trạng thái) không dính nhau', () => {
    const other = new SocketTypingState(() => now);
    state.claimSlot('c1');
    state.remember('c1', 'user-2');

    expect(other.claimSlot('c1')).toBe(true);
    expect(other.recall('c1')).toBeUndefined();
  });

  it('đồng hồ mặc định là Date.now đọc lúc gọi (đồng hồ giả của jest có hiệu lực)', () => {
    jest.useFakeTimers({ now: new Date('2030-01-01T00:00:00.000Z') });
    try {
      const real = new SocketTypingState();
      real.claimSlot('c1');

      jest.advanceTimersByTime(CHAT_TYPING_MIN_INTERVAL_MS);

      expect(real.claimSlot('c1')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
