import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';

type Messages = Record<string, Record<string, string>>;

const viMessages = vi as unknown as Messages;
const enMessages = en as unknown as Messages;

// Message lỗi validate của schema là key i18n (packages/types +
// schemas/ProductForm ở FE) — thiếu key ở 1 ngôn ngữ thì next-intl không
// throw mà useValidationMessage rơi về hiện chính chuỗi key thô cho người
// dùng. Test quét mã nguồn để không phải liệt kê key thủ công.
const SOURCE_DIRS = [
  join(__dirname, '../../../../../packages/types/src'),
  join(__dirname, '../../modules'),
];
const KEY_PATTERN =
  /['"`]((?:auth|shop|product|cart|voucher|checkout|order|admin|review)\.validation[A-Za-z0-9]+)['"`]/g;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const usedKeys = [
  ...new Set(
    SOURCE_DIRS.flatMap(listSourceFiles).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(KEY_PATTERN)].map((match) => match[1]),
    ),
  ),
].sort();

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

describe('key lỗi validate', () => {
  it('tìm thấy key trong mã nguồn (không quét hụt)', () => {
    expect(usedKeys.length).toBeGreaterThan(30);
  });

  it.each(usedKeys)('%s: có ở cả vi và en, cùng placeholder', (key) => {
    const viText = lookup(viMessages, key);
    const enText = lookup(enMessages, key);

    expect(viText?.trim()).toBeTruthy();
    expect(enText?.trim()).toBeTruthy();
    expect(placeholders(enText as string)).toBe(placeholders(viText as string));
  });
});
