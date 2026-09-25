-- AlterTable
ALTER TABLE "products" ADD COLUMN     "search_vector" tsvector;

-- CreateIndex
CREATE INDEX "products_search_vector_idx" ON "products" USING GIN ("search_vector");

-- Week5.md Bước 1.6/2.4b: 2 phần dưới đây KHÔNG do Prisma tự sinh (Prisma
-- không có khái niệm trigger) — viết tay, giữ nguyên nếu sau này chạy lại
-- `prisma migrate dev`/`diff` (Prisma chỉ diff phần schema.prisma quản lý
-- được, không đụng tới trigger đã áp dụng ngoài schema).

-- Cấu hình 'simple' (không phải 'english') vì nội dung chủ yếu tiếng Việt,
-- Postgres core không có dictionary tiếng Việt — unaccent() xử lý bỏ dấu
-- riêng trước khi đưa vào to_tsvector. name trọng số A, description trọng
-- số B (đã chốt ở 1.9), ghép 2 tsvector bằng toán tử `||`.
CREATE OR REPLACE FUNCTION products_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.name, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.description, ''))), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- BEFORE INSERT OR UPDATE OF ... : chỉ chạy lại khi đúng name/description
-- đổi (không chạy thừa khi update các field khác như status/minPrice).
CREATE TRIGGER products_search_vector_trigger
BEFORE INSERT OR UPDATE OF name, description ON products
FOR EACH ROW EXECUTE FUNCTION products_search_vector_update();

-- Backfill cho các row đã tồn tại trước khi có trigger (trigger chỉ chạy cho
-- INSERT/UPDATE về sau, không tự chạy ngược cho dữ liệu cũ).
UPDATE "products" SET
  search_vector =
    setweight(to_tsvector('simple', unaccent(coalesce(name, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(description, ''))), 'B');
