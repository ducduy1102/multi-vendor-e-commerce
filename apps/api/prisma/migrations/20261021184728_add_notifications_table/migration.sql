-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_id_idx" ON "notifications"("user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_id_idx" ON "notifications"("user_id", "read_at", "created_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Bất biến của hàng thông báo (Prisma không khai được CHECK trong schema.prisma). Lưới an toàn cuối cho mọi đường
-- đi vòng qua NotificationService; service vẫn kiểm bằng Zod (packages/types/src/notification.ts) trước khi ghi.
-- 1) type: 1..64 ký tự (khớp NOTIFICATION_TYPE_MAX_LENGTH ở packages/types).
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_length_in_range" CHECK (char_length("type") BETWEEN 1 AND 64);

-- 2) data: phải là JSON object (không phải mảng/chuỗi/số/null) — Zod union phân biệt theo type luôn tạo object.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_data_is_object" CHECK (jsonb_typeof("data") = 'object');

-- 3) data: tối đa 2048 byte. Zod giới hạn 1024 byte trên JSON gọn (NOTIFICATION_DATA_MAX_BYTES); DB nới gấp đôi vì
-- jsonb::text chèn thêm dấu cách sau ':' và ',' nên dài hơn JSON gọn, và để "Zod cho qua mà CHECK từ chối" không bao
-- giờ xảy ra. Đây chỉ là chặn dữ liệu phình to (không phải nơi quyết định hình dạng) — đổi hằng số ở packages/types
-- thì xem lại cận này bằng một migration mới.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_data_size_limit" CHECK (octet_length("data"::text) <= 2048);
