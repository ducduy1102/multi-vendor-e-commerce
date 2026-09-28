import { AppException } from '../exceptions/app.exception';

interface ExpectedAppException {
  status: number;
  code: string;
  // Message GIỮ NGUYÊN khi di chuyển lỗi cũ sang có mã (Week7.md 1.16) — luôn kiểm nếu có.
  message?: string;
  details?: unknown;
}

// Chờ `promise` bị từ chối bằng AppException với đúng status/code (và message/details nếu truyền).
export async function expectAppException(
  promise: Promise<unknown>,
  expected: ExpectedAppException,
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppException);
  const exception = error as AppException;
  expect(exception.getStatus()).toBe(expected.status);
  expect(exception.code).toBe(expected.code);
  if (expected.message !== undefined) {
    expect(exception.message).toBe(expected.message);
  }
  if ('details' in expected) {
    expect(exception.details).toEqual(expected.details);
  }
}
