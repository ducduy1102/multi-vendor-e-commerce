import { describe, expect, it } from 'vitest';

import {
  classifyDay,
  classifyListTime,
  formatUnread,
  groupMessages,
  initialsOf,
  isRetryableFailure,
  localDayKey,
} from './chat-format';
import { CONVERSATION_ID, uuid } from './chat-test-data';
import type { ChatMessageView } from './hooks/chat-messages';

// Mọi mốc dựng bằng thành phần GIỜ ĐỊA PHƯƠNG (như người dùng thấy) nên test đúng ở mọi múi giờ của máy chạy test.
const local = (day: number, hour = 12, minute = 0, second = 0) =>
  new Date(2030, 0, day, hour, minute, second);
const iso = (date: Date) => date.toISOString();

describe('formatUnread', () => {
  it.each([
    [0, ''],
    [-3, ''],
    [Number.NaN, ''],
    [1, '1'],
    [99, '99'],
    [100, '99+'],
    [5000, '99+'],
    [3.9, '3'],
  ])('%s -> %j', (count, expected) => {
    expect(formatUnread(count)).toBe(expected);
  });
});

describe('initialsOf', () => {
  it.each([
    ['Nguyễn Văn A', 'NA'],
    ['  Trần   Thị  Bé ', 'TB'],
    ['Shop', 'SH'],
    ['x', 'X'],
    ['', '?'],
    ['   ', '?'],
    ['shop áo xinh', 'SX'],
  ])('%j -> %j', (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });

  it('không cắt đôi cặp surrogate của emoji', () => {
    expect(initialsOf('😀😀😀')).toBe('😀😀');
    expect(initialsOf('😀 shop')).toBe('😀S');
  });
});

describe('localDayKey', () => {
  it('theo giờ địa phương (YYYY-MM-DD), có đệm số 0', () => {
    expect(localDayKey(iso(local(2, 0, 0, 1)))).toBe('2030-01-02');
    expect(localDayKey(iso(local(2, 23, 59, 59)))).toBe('2030-01-02');
    expect(localDayKey(iso(local(3, 0, 0, 0)))).toBe('2030-01-03');
  });
});

describe('classifyListTime', () => {
  const now = local(10, 12, 0, 0).getTime();

  it('dưới 1 phút (kể cả thời điểm ở tương lai do đồng hồ lệch) ⇒ vừa xong', () => {
    expect(classifyListTime(iso(local(10, 11, 59, 30)), now)).toEqual({ kind: 'justNow' });
    expect(classifyListTime(iso(local(10, 12, 0, 0)), now)).toEqual({ kind: 'justNow' });
    expect(classifyListTime(iso(local(10, 12, 5, 0)), now)).toEqual({ kind: 'justNow' });
  });

  it('trong cùng ngày: phút rồi giờ, đúng biên 60 phút', () => {
    expect(classifyListTime(iso(local(10, 11, 59, 0)), now)).toEqual({
      kind: 'minutes',
      count: 1,
    });
    expect(classifyListTime(iso(local(10, 11, 1, 0)), now)).toEqual({
      kind: 'minutes',
      count: 59,
    });
    expect(classifyListTime(iso(local(10, 11, 0, 0)), now)).toEqual({ kind: 'hours', count: 1 });
    expect(classifyListTime(iso(local(10, 0, 30, 0)), now)).toEqual({ kind: 'hours', count: 11 });
  });

  it('ngày lịch hôm qua ⇒ "hôm qua", kể cả khi mới cách chưa tới 24 giờ (23h30 hôm trước lúc 00h10)', () => {
    const justAfterMidnight = local(10, 0, 10, 0).getTime();
    expect(classifyListTime(iso(local(9, 23, 30, 0)), justAfterMidnight)).toEqual({
      kind: 'yesterday',
    });
    expect(classifyListTime(iso(local(9, 1, 0, 0)), now)).toEqual({ kind: 'yesterday' });
  });

  it('xa hơn ⇒ ngày tháng', () => {
    const result = classifyListTime(iso(local(7, 9, 0, 0)), now);
    expect(result.kind).toBe('date');
    expect(result.kind === 'date' && result.date.getDate()).toBe(7);
  });
});

describe('classifyDay', () => {
  const now = local(10, 15, 0, 0).getTime();

  it('hôm nay / hôm qua / ngày đầy đủ (theo ngày lịch địa phương)', () => {
    expect(classifyDay(iso(local(10, 0, 0, 1)), now)).toEqual({ kind: 'today' });
    expect(classifyDay(iso(local(9, 23, 59, 59)), now)).toEqual({ kind: 'yesterday' });
    expect(classifyDay(iso(local(8, 12, 0, 0)), now).kind).toBe('date');
  });

  it('thời điểm ở tương lai ⇒ coi là hôm nay (không hiện nhãn lạ)', () => {
    expect(classifyDay(iso(local(11, 9, 0, 0)), now)).toEqual({ kind: 'today' });
  });
});

describe('groupMessages', () => {
  let counter = 0;
  const message = (
    createdAt: Date,
    senderRole: 'BUYER' | 'SHOP' = 'BUYER',
    overrides: Partial<ChatMessageView> = {},
  ): ChatMessageView => ({
    id: uuid(++counter),
    conversationId: CONVERSATION_ID,
    senderRole,
    content: `tin ${counter}`,
    createdAt: iso(createdAt),
    ...overrides,
  });

  it('danh sách rỗng ⇒ không có ngày nào', () => {
    expect(groupMessages([])).toEqual([]);
  });

  it('đảo MỚI NHẤT trước thành CŨ → MỚI để hiển thị', () => {
    const oldest = message(local(10, 9, 0));
    const middle = message(local(10, 9, 1));
    const newest = message(local(10, 9, 2));

    const [day] = groupMessages([newest, middle, oldest]);

    expect(day.runs[0].messages.map((m) => m.id)).toEqual([oldest.id, middle.id, newest.id]);
  });

  it('cùng người, cách nhau ≤ 5 phút ⇒ MỘT nhóm; quá 5 phút ⇒ tách nhóm', () => {
    const a = message(local(10, 9, 0, 0));
    const b = message(local(10, 9, 5, 0)); // đúng 5 phút: vẫn cùng nhóm
    const c = message(local(10, 9, 10, 1)); // 5 phút 1 giây sau b: nhóm mới

    const [day] = groupMessages([c, b, a]);

    expect(day.runs.map((run) => run.messages.map((m) => m.id))).toEqual([[a.id, b.id], [c.id]]);
  });

  it('đổi người gửi ⇒ nhóm mới dù chỉ cách vài giây', () => {
    const mine = message(local(10, 9, 0, 0), 'BUYER');
    const theirs = message(local(10, 9, 0, 5), 'SHOP');
    const mineAgain = message(local(10, 9, 0, 9), 'BUYER');

    const [day] = groupMessages([mineAgain, theirs, mine]);

    expect(day.runs.map((run) => run.senderRole)).toEqual(['BUYER', 'SHOP', 'BUYER']);
  });

  it('chia ngày theo giờ địa phương: 23h59 và 00h01 là hai ngày, mỗi ngày bắt đầu nhóm mới', () => {
    const lateNight = message(local(10, 23, 59, 0));
    const afterMidnight = message(local(11, 0, 1, 0));

    const days = groupMessages([afterMidnight, lateNight]);

    expect(days.map((d) => d.key)).toEqual(['2030-01-10', '2030-01-11']);
    expect(days.map((d) => d.runs.length)).toEqual([1, 1]);
    expect(days[1].firstAt).toBe(afterMidnight.createdAt);
  });

  it('tin tạm luôn đứng CUỐI cùng nhóm với tin của mình dù đồng hồ máy lệch về quá khứ', () => {
    const sent = message(local(10, 9, 0, 0), 'BUYER');
    const pending = message(local(10, 8, 59, 0), 'BUYER', {
      id: 'pending:abc',
      deliveryStatus: 'sending',
    });

    const days = groupMessages([pending, sent]);

    const flat = days.flatMap((d) => d.runs.flatMap((r) => r.messages.map((m) => m.id)));
    expect(flat).toEqual([sent.id, 'pending:abc']);
  });

  it('tin tạm lệch sang ngày khác không kéo ngược dải ngày cũ ra sau (gom theo tin liên tiếp, không theo bảng tra)', () => {
    const day10a = message(local(10, 9, 0, 0), 'BUYER');
    const day11 = message(local(11, 9, 0, 0), 'SHOP');
    // Tin tạm mang giờ máy của ngày 10 nhưng đứng sau tin ngày 11.
    const pending = message(local(10, 20, 0, 0), 'BUYER', { id: 'pending:x' });

    const days = groupMessages([pending, day11, day10a]);

    expect(days.map((d) => d.key)).toEqual(['2030-01-10', '2030-01-11', '2030-01-10']);
  });
});

describe('isRetryableFailure', () => {
  it.each([
    [{ status: 0 }, true],
    [{ status: 500 }, true],
    [{ status: 503 }, true],
    [{ status: 429, code: 'CHAT_RATE_LIMITED' }, true],
    [{ status: 429, code: 'CHAT_AWAITING_REPLY' }, true],
    [{ status: 400 }, false],
    [{ status: 401 }, false],
    [{ status: 403 }, false],
    [{ status: 404, code: 'CHAT_NOT_PARTICIPANT' }, false],
    [{ status: 409, code: 'CHAT_SHOP_UNAVAILABLE' }, false],
  ])('%j -> %s', (failure, expected) => {
    expect(isRetryableFailure(failure)).toBe(expected);
  });
});
