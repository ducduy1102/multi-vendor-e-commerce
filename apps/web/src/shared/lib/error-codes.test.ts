import { ERROR_CODES } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';

import { ApiError } from './api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode, getErrorDetails } from './error-codes';

type Messages = Record<string, Record<string, string> | undefined>;

const viMessages = vi as unknown as Messages;
const enMessages = en as unknown as Messages;

function lookup(messages: Messages, key: string): string | undefined {
  const [namespace, name] = key.split('.');
  return messages[namespace]?.[name];
}

function placeholders(message: string): string {
  return [...message.matchAll(/\{(\w+)/g)]
    .map((match) => match[1])
    .sort()
    .join(',');
}

describe('ERROR_CODE_MESSAGE_KEYS', () => {
  it('mọi ERROR_CODES đều có key trong map (không sót mã mới)', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_CODE_MESSAGE_KEYS[code], `thiếu key cho mã ${code}`).toBeTruthy();
    }
  });

  it.each(ERROR_CODES)('%s: key có bản dịch ở cả vi và en, cùng placeholder', (code) => {
    const key = ERROR_CODE_MESSAGE_KEYS[code];
    const viText = lookup(viMessages, key);
    const enText = lookup(enMessages, key);

    expect(viText?.trim(), `vi thiếu key "${key}"`).toBeTruthy();
    expect(enText?.trim(), `en thiếu key "${key}"`).toBeTruthy();
    expect(placeholders(enText as string)).toBe(placeholders(viText as string));
  });

  it('không có 2 mã khác nhau vô tình trỏ chung 1 key TRỪ nhóm cố ý dùng lại (ACCOUNT_NOT_ACTIVE)', () => {
    const seen = new Map<string, string[]>();
    for (const code of ERROR_CODES) {
      const key = ERROR_CODE_MESSAGE_KEYS[code];
      seen.set(key, [...(seen.get(key) ?? []), code]);
    }
    const duplicates = [...seen.entries()].filter(([, codes]) => codes.length > 1);
    expect(duplicates).toEqual([]);
  });
});

describe('getErrorCode', () => {
  it('code hợp lệ -> trả về đúng ErrorCode', () => {
    const error = new ApiError('Voucher has expired', 400, 'VOUCHER_EXPIRED');
    expect(getErrorCode(error)).toBe('VOUCHER_EXPIRED');
  });

  it('không có code (lỗi cũ chưa di chuyển) -> undefined', () => {
    const error = new ApiError('Something went wrong', 500);
    expect(getErrorCode(error)).toBeUndefined();
  });

  it('code lạ (BE thêm sau, FE chưa cập nhật ERROR_CODES) -> undefined, không ném lỗi', () => {
    const error = new ApiError('New reason', 409, 'SOME_FUTURE_CODE');
    expect(getErrorCode(error)).toBeUndefined();
  });
});

describe('getErrorDetails', () => {
  it('details đúng hình dạng -> parse thành công', () => {
    expect(getErrorDetails({ minAmount: 300000 }, 'VOUCHER_BELOW_MINIMUM')).toEqual({
      minAmount: 300000,
    });
    expect(getErrorDetails({ available: 3 }, 'INSUFFICIENT_STOCK')).toEqual({ available: 3 });
  });

  it('details sai hình dạng -> undefined, không ném lỗi', () => {
    expect(getErrorDetails({ minAmount: 'not-a-number' }, 'VOUCHER_BELOW_MINIMUM')).toBeUndefined();
    expect(getErrorDetails(undefined, 'VOUCHER_BELOW_MINIMUM')).toBeUndefined();
    expect(getErrorDetails(null, 'CART_FULL')).toBeUndefined();
  });
});
