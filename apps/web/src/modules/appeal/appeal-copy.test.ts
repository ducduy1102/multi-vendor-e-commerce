import { describe, expect, it } from 'vitest';

import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { APPEAL_COPY_KEYS, type AppealKind } from './appeal-copy';

const KINDS: AppealKind[] = ['shop', 'product'];

describe('APPEAL_COPY_KEYS', () => {
  it('phủ cả hai loại đối tượng (shop bị khoá, sản phẩm bị gỡ) với cùng một bộ khoá', () => {
    expect(Object.keys(APPEAL_COPY_KEYS).sort()).toEqual(['product', 'shop']);
    expect(Object.keys(APPEAL_COPY_KEYS.product).sort()).toEqual(
      Object.keys(APPEAL_COPY_KEYS.shop).sort(),
    );
  });

  it.each(KINDS)('%s: mọi khoá đều có bản dịch ở cả vi lẫn en (namespace appeal)', (kind) => {
    for (const key of Object.values(APPEAL_COPY_KEYS[kind])) {
      expect([kind, key, viMessages.appeal[key as keyof typeof viMessages.appeal]]).toEqual([
        kind,
        key,
        expect.any(String),
      ]);
      expect([kind, key, enMessages.appeal[key as keyof typeof enMessages.appeal]]).toEqual([
        kind,
        key,
        expect.any(String),
      ]);
    }
  });

  it('khoá của shop giữ NGUYÊN tên cũ (không đổi bản dịch đang dùng ở trang quản lý shop)', () => {
    expect(APPEAL_COPY_KEYS.shop).toEqual({
      sectionTitle: 'sectionTitle',
      sectionDescription: 'sectionDescription',
      dialogTitle: 'dialogTitle',
      dialogDescription: 'dialogDescription',
      messagePlaceholder: 'messagePlaceholder',
      closedHint: 'closedHint',
      errorNotAllowed: 'errorNotAllowed',
      errorAlreadySent: 'errorAlreadySent',
    });
  });

  it('hai loại không dùng chung khoá nào: lời văn của sản phẩm không rơi về lời văn của shop', () => {
    const shopKeys = new Set(Object.values(APPEAL_COPY_KEYS.shop));
    for (const key of Object.values(APPEAL_COPY_KEYS.product)) {
      expect(shopKeys.has(key)).toBe(false);
    }
  });

  it('lời văn của sản phẩm nói về "gỡ", không nhắc "khoá shop"', () => {
    for (const messages of [viMessages.appeal, enMessages.appeal]) {
      const text = [
        messages.productSectionTitle,
        messages.productSectionDescription,
        messages.productDialogTitle,
        messages.productDialogDescription,
        messages.productClosedHint,
        messages.productErrorNotAllowed,
        messages.productErrorAlreadySent,
      ].join(' ');
      expect(text).not.toMatch(/khoá|khóa|suspend|unlock|unlocked/i);
    }
  });
});
