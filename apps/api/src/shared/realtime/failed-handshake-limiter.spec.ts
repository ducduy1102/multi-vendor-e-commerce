import { createFailedHandshakeLimiter } from './failed-handshake-limiter';

// Đồng hồ giả để không phải chờ thật.
function clock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('createFailedHandshakeLimiter', () => {
  it('chưa ghi lỗi nào thì không bị chặn', () => {
    const limiter = createFailedHandshakeLimiter();

    expect(limiter.isBlocked('1.1.1.1')).toBe(false);
  });

  it('chặn đúng khi chạm ngưỡng, và chỉ báo "vừa bị chặn" ở lần chạm ngưỡng', () => {
    const t = clock();
    const limiter = createFailedHandshakeLimiter({
      maxFailures: 3,
      windowMs: 60_000,
      now: t.now,
    });

    expect(limiter.recordFailure('a')).toBe(false);
    expect(limiter.recordFailure('a')).toBe(false);
    expect(limiter.isBlocked('a')).toBe(false);
    expect(limiter.recordFailure('a')).toBe(true);
    expect(limiter.isBlocked('a')).toBe(true);
    // Đã bị chặn: các lần ghi tiếp không báo "vừa bị chặn" nữa (nơi gọi chỉ log một lần).
    expect(limiter.recordFailure('a')).toBe(false);
    expect(limiter.isBlocked('a')).toBe(true);
  });

  it('mỗi khoá đếm riêng', () => {
    const limiter = createFailedHandshakeLimiter({ maxFailures: 2 });
    limiter.recordFailure('a');
    limiter.recordFailure('a');

    expect(limiter.isBlocked('a')).toBe(true);
    expect(limiter.isBlocked('b')).toBe(false);
  });

  it('hết cửa sổ thì hết chặn, rồi đếm lại từ đầu', () => {
    const t = clock();
    const limiter = createFailedHandshakeLimiter({
      maxFailures: 2,
      windowMs: 60_000,
      now: t.now,
    });
    limiter.recordFailure('a');
    limiter.recordFailure('a');
    expect(limiter.isBlocked('a')).toBe(true);

    t.advance(59_999);
    expect(limiter.isBlocked('a')).toBe(true);
    t.advance(1);
    expect(limiter.isBlocked('a')).toBe(false);

    // Cửa sổ mới: một lỗi chưa đủ để chặn lại.
    expect(limiter.recordFailure('a')).toBe(false);
    expect(limiter.isBlocked('a')).toBe(false);
    expect(limiter.recordFailure('a')).toBe(true);
    expect(limiter.isBlocked('a')).toBe(true);
  });

  it('lỗi rải rác ở các cửa sổ khác nhau không cộng dồn', () => {
    const t = clock();
    const limiter = createFailedHandshakeLimiter({
      maxFailures: 2,
      windowMs: 1_000,
      now: t.now,
    });

    for (let i = 0; i < 10; i++) {
      limiter.recordFailure('a');
      t.advance(1_000);
    }

    expect(limiter.isBlocked('a')).toBe(false);
  });

  it('ngưỡng 1: lỗi đầu tiên đã chặn', () => {
    const limiter = createFailedHandshakeLimiter({ maxFailures: 1 });

    expect(limiter.recordFailure('a')).toBe(true);
    expect(limiter.isBlocked('a')).toBe(true);
  });

  describe('bộ nhớ có trần', () => {
    it('đầy toàn khoá còn sống: bỏ khoá cũ nhất, các khoá mới vẫn bị chặn đúng', () => {
      const t = clock();
      const limiter = createFailedHandshakeLimiter({
        maxFailures: 1,
        windowMs: 60_000,
        maxTrackedKeys: 3,
        now: t.now,
      });
      for (const key of ['a', 'b', 'c']) {
        limiter.recordFailure(key);
        t.advance(10);
      }

      limiter.recordFailure('d');

      expect(limiter.isBlocked('a')).toBe(false); // bị đẩy ra
      expect(limiter.isBlocked('b')).toBe(true);
      expect(limiter.isBlocked('c')).toBe(true);
      expect(limiter.isBlocked('d')).toBe(true);
    });

    it('ưu tiên dọn khoá đã hết hạn trước khi bỏ khoá còn sống', () => {
      const t = clock();
      const limiter = createFailedHandshakeLimiter({
        maxFailures: 1,
        windowMs: 1_000,
        maxTrackedKeys: 2,
        now: t.now,
      });
      limiter.recordFailure('old'); // sẽ hết hạn
      t.advance(5_000);
      limiter.recordFailure('live'); // còn sống

      limiter.recordFailure('new'); // đầy: phải dọn 'old', giữ 'live'

      expect(limiter.isBlocked('live')).toBe(true);
      expect(limiter.isBlocked('new')).toBe(true);
    });
  });
});
