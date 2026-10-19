import {
  CLOUDINARY_INCOMING_TRANSFORMATION,
  CLOUDINARY_UPLOAD_FOLDER,
} from '@ecommerce/types';
import type { CloudinaryService } from '../../shared/cloudinary/cloudinary.service';
import { ProductController } from './product.controller';
import type { ProductService } from './product.service';

// POST /uploads/signature (Week10.md 2.4): endpoint ký cho FE tự upload thẳng lên Cloudinary. Param nào được đưa
// vào chữ ký thì client KHÔNG sửa/bỏ được mà không làm hỏng chữ ký — nên việc ký đủ `folder` lẫn `transformation`
// là cách ép giới hạn kích thước ảnh phía server. Đã kiểm với Cloudinary thật; test này giữ cho nó không bị mất
// âm thầm khi ai đó sửa controller.
describe('ProductController.uploadSignature', () => {
  const signed = {
    signature: 'sig',
    timestamp: 1,
    apiKey: 'key',
    cloudName: 'cloud',
  };
  let cloudinary: { generateUploadSignature: jest.Mock };
  let controller: ProductController;

  beforeEach(() => {
    cloudinary = { generateUploadSignature: jest.fn().mockReturnValue(signed) };
    controller = new ProductController(
      {} as ProductService,
      cloudinary as unknown as CloudinaryService,
    );
  });

  it('ký cả folder lẫn incoming transformation bằng hằng số dùng chung với FE', () => {
    controller.uploadSignature();

    expect(cloudinary.generateUploadSignature).toHaveBeenCalledTimes(1);
    expect(cloudinary.generateUploadSignature).toHaveBeenCalledWith({
      folder: CLOUDINARY_UPLOAD_FOLDER,
      transformation: CLOUDINARY_INCOMING_TRANSFORMATION,
    });
  });

  it('các chuỗi đã ký đúng bằng giá trị FE đang gửi (viết thẳng literal để bắt đổi hằng số quên đồng bộ)', () => {
    controller.uploadSignature();

    expect(cloudinary.generateUploadSignature).toHaveBeenCalledWith({
      folder: 'multi-vendor-ecommerce',
      transformation: 'c_limit,w_1600,h_1600,q_auto,f_auto',
    });
  });

  it('trả nguyên chữ ký (không thêm bớt field, không lộ apiSecret)', () => {
    const result = controller.uploadSignature();

    expect(result).toEqual(signed);
    expect(Object.keys(result).sort()).toEqual([
      'apiKey',
      'cloudName',
      'signature',
      'timestamp',
    ]);
  });
});
