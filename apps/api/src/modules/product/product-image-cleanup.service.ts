import { Injectable, Logger } from '@nestjs/common';
import { CloudinaryService } from '../../shared/cloudinary/cloudinary.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

// Dọn ảnh sản phẩm khỏi Cloudinary sau khi chúng bị gỡ khỏi DB (Week10.md 2.4). Ảnh được tải thẳng từ trình
// duyệt lên Cloudinary rồi mới lưu URL vào DB, nên gỡ ảnh khỏi biến thể chỉ xoá DÒNG trong
// `product_images` — tệp thật vẫn nằm trên Cloudinary và tốn dung lượng mãi mãi nếu không xoá.
//
// KHÔNG được xoá bừa. Một URL ảnh còn có thể được tham chiếu ở nơi khác dù đã bị gỡ khỏi biến thể này:
//   - `order_items.image_url`: ẢNH CHỤP LẠI lúc mua (snapshot) — xoá tệp là vỡ ảnh trong lịch sử đơn của người
//     mua, đơn của người bán và các màn hoàn tiền;
//   - `product_images.url` của biến thể/sản phẩm khác (cùng một ảnh dùng cho nhiều biến thể, hoặc vừa chuyển
//     sang biến thể khác trong cùng lần sửa);
//   - `shops.logo_url` / `shops.banner_url` (người dùng tự nhập URL, có thể trỏ cùng ảnh).
// Chỉ xoá khi KHÔNG còn nơi nào chứa public_id đó. Kiểm bằng "chứa chuỗi" chứ không so bằng, nên URL đã biến đổi
// hay đổi đuôi file của cùng ảnh cũng được tính là còn tham chiếu — sai lệch chỉ có hướng giữ lại thừa, không
// bao giờ xoá nhầm.
//
// Hàm duy nhất ở đây chạy SAU KHI giao dịch DB đã commit và KHÔNG BAO GIỜ ném (rules/backend.md mục 4,
// side-effect sau khi ghi DB): lỗi chỉ để lại một ảnh mồ côi, không được làm hỏng việc sửa sản phẩm đã xong.
@Injectable()
export class ProductImageCleanupService {
  private readonly logger = new Logger(ProductImageCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // `urls`: ảnh vừa bị gỡ khỏi DB (đã commit). URL không phải ảnh do chính hệ thống tải lên (cloud khác, URL đã
  // biến đổi, chuỗi tự nhập...) bị bỏ qua hoàn toàn — xem parseManagedImageUrl.
  async deleteUnreferenced(urls: string[]): Promise<void> {
    try {
      const publicIds = [
        ...new Set(
          urls
            .map((url) => this.cloudinary.getManagedPublicId(url))
            .filter((id): id is string => id !== null),
        ),
      ];
      if (publicIds.length === 0) return;

      // Truy vấn tham chiếu lỗi ⇒ ném tới catch bên dưới ⇒ KHÔNG xoá gì (an toàn khi không chắc).
      const referenced = await this.findReferencedPublicIds(publicIds);
      const unreferenced = publicIds.filter((id) => !referenced.has(id));
      if (unreferenced.length === 0) return;

      await this.cloudinary.deleteImages(unreferenced);
    } catch (error) {
      this.logger.error(
        `Dọn ảnh sản phẩm thất bại (bỏ qua, không ảnh hưởng thao tác đã xong): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Tập public_id còn xuất hiện ở BẤT KỲ cột chứa URL ảnh nào. 3 truy vấn song song, mỗi bảng một lần cho cả
  // lô (không N+1). `order_items.image_url` không có chỉ mục nên đây là một lần quét bảng — chấp nhận được vì
  // chỉ chạy khi người bán GỠ ảnh (hiếm), không phải mỗi lần xem/đặt hàng.
  private async findReferencedPublicIds(
    publicIds: string[],
  ): Promise<Set<string>> {
    const [images, orderItems, shops] = await Promise.all([
      this.prisma.productImage.findMany({
        where: { OR: publicIds.map((id) => ({ url: { contains: id } })) },
        select: { url: true },
      }),
      this.prisma.orderItem.findMany({
        where: { OR: publicIds.map((id) => ({ imageUrl: { contains: id } })) },
        select: { imageUrl: true },
      }),
      this.prisma.shop.findMany({
        where: {
          OR: publicIds.flatMap((id) => [
            { logoUrl: { contains: id } },
            { bannerUrl: { contains: id } },
          ]),
        },
        select: { logoUrl: true, bannerUrl: true },
      }),
    ]);

    const stored: string[] = [
      ...images.map((image) => image.url),
      ...orderItems.map((item) => item.imageUrl),
      ...shops.flatMap((shop) => [shop.logoUrl, shop.bannerUrl]),
    ].filter((value): value is string => typeof value === 'string');

    return new Set(
      publicIds.filter((id) => stored.some((value) => value.includes(id))),
    );
  }
}
