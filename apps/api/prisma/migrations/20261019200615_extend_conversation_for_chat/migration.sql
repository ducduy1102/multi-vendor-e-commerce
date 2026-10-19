-- DropIndex
DROP INDEX "conversations_shop_id_idx";

-- DropIndex
DROP INDEX "messages_conversation_id_idx";

-- DropIndex
DROP INDEX "messages_sender_id_idx";

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "buyer_last_read_at" TIMESTAMP(3),
ADD COLUMN     "last_message_at" TIMESTAMP(3),
ADD COLUMN     "shop_last_read_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "client_message_id" UUID;

-- CreateIndex
CREATE INDEX "conversations_shop_id_last_message_at_idx" ON "conversations"("shop_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_buyer_id_last_message_at_idx" ON "conversations"("buyer_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_id_idx" ON "messages"("conversation_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "messages_sender_id_created_at_idx" ON "messages"("sender_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_sender_id_client_message_id_key" ON "messages"("conversation_id", "sender_id", "client_message_id");


-- Bất biến nội dung tin nhắn (Prisma không khai được CHECK trong schema.prisma): 1 <= độ dài <= 1000 ký tự.
-- Lưới an toàn cuối cho mọi đường đi vòng qua ChatService. Khớp CHAT_MESSAGE_MAX_LENGTH ở packages/types: đổi
-- hằng số đó thì phải đổi cả CHECK này bằng một migration mới. char_length đếm KÝ TỰ (code point) còn Zod đếm
-- đơn vị UTF-16 nên Zod luôn chặt hơn hoặc bằng — không bao giờ có chuyện Zod cho qua mà CHECK từ chối.
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_length_in_range" CHECK (char_length("content") BETWEEN 1 AND 1000);
