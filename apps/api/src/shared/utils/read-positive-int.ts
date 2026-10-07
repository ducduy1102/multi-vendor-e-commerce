import { z } from 'zod';

// Đọc ENV là số nguyên dương LÚC DÙNG (không lúc boot — rules/backend.md mục 8). Biến không khai, để
// trống (`VAR=` ⇒ chuỗi rỗng, nên dùng `?.trim() ||` chứ không phải `??` — rules/general.md mục 4) hoặc
// không phải số nguyên dương ⇒ về giá trị mặc định, KHÔNG ném lỗi.
export function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim() || String(fallback);
  const parsed = z.coerce.number().int().positive().safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}
