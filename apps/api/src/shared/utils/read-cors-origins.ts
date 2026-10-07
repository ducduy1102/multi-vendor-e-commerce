// Origin FE cho phép gọi kèm cookie (credentials). CORS_ORIGIN có thể là nhiều origin cách nhau bởi
// dấu phẩy, vd khi `next dev` tự đổi cổng lúc 3000 đã bị chiếm. Biến không khai hoặc để trống
// (`VAR=` ⇒ chuỗi rỗng, `''.split(',')` ra `['']` — một origin rỗng, chặn mọi trình duyệt — nên không
// dùng `?.split(',') ?? mặc định`, rules/general.md mục 4) ⇒ về mặc định cho 2 cổng hay dùng ở local.
export const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
];

export function readCorsOrigins(): string[] {
  const origins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : DEFAULT_CORS_ORIGINS;
}
