-- Week5.md Bước 1.6/1.7/2.4: bật extension `unaccent` (contrib module có sẵn
-- trong image postgres:16-alpine, không cần cài thêm gì) để so khớp search
-- không phân biệt dấu tiếng Việt (vd "áo" ~ "ao"). Raw SQL trong migration
-- thường (không dùng preview feature `postgresqlExtensions` của Prisma —
-- đã chốt ở 1.7, giữ đúng nguyên tắc project chưa dùng preview feature nào).
--
-- Chỉ bật `unaccent`, không bật `pg_trgm` — thiết kế cuối cùng ở 1.6 dùng
-- to_tsvector/plainto_tsquery (Postgres full-text search chuẩn), không dùng
-- fuzzy/similarity theo trigram, nên không cần pg_trgm.
CREATE EXTENSION IF NOT EXISTS unaccent;
