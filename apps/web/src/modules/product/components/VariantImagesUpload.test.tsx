import { PRODUCT_VARIANT_MAX_IMAGES } from '@ecommerce/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ImageProcessingError } from './compressProductImage';
import { VariantImagesUpload } from './VariantImagesUpload';

const mocks = vi.hoisted(() => ({
  compress: vi.fn(),
  upload: vi.fn(),
  mutateAsync: vi.fn(),
}));

// Chỉ thay phần phụ thuộc trình duyệt/mạng (nén bằng canvas, gọi Cloudinary, lấy chữ ký); giữ nguyên
// validateImageSelection và ImageProcessingError thật để test kiểm đúng luật giới hạn.
vi.mock('./compressProductImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./compressProductImage')>()),
  compressProductImage: mocks.compress,
}));
vi.mock('./uploadToCloudinary', () => ({ uploadToCloudinary: mocks.upload }));
vi.mock('../hooks/useUploadSignature', () => ({
  useUploadSignature: () => ({ mutateAsync: mocks.mutateAsync }),
}));

// next/image cần cấu hình hostname của Next khi render URL ngoài — ở test chỉ cần một thẻ img.
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const LABELS = {
  uploadLabel: 'Thêm ảnh',
  uploadingLabel: 'Đang tải lên...',
  removeLabel: 'Xoá ảnh',
  moveUpLabel: 'Di chuyển lên',
  moveDownLabel: 'Di chuyển xuống',
  errorLabel: 'Tải ảnh thất bại, thử lại',
};

const url = (i: number) => `https://res.cloudinary.com/demo/image/upload/${i}.webp`;

function makeFile(name: string, type = 'image/jpeg', size?: number): File {
  const file = new File(['x'], name, { type });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
}

function setup(value: string[] = []) {
  const onChange = vi.fn();
  // applyAccept: false — trình duyệt thật vẫn cho chọn "mọi tệp" bất chấp `accept`, nên test phải để file sai
  // kiểu lọt tới được tới code kiểm.
  const user = userEvent.setup({ applyAccept: false });
  const view = render(
    withIntl(<VariantImagesUpload value={value} onChange={onChange} {...LABELS} />),
  );
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  return { user, onChange, input, ...view };
}

describe('VariantImagesUpload', () => {
  beforeEach(() => {
    // Mặc định: nén trả đúng file bản nén riêng (khác file gốc), upload trả URL theo thứ tự gọi.
    mocks.compress.mockImplementation(
      async (file: File) => new File(['c'], `c-${file.name}`, { type: 'image/webp' }),
    );
    mocks.mutateAsync.mockResolvedValue({
      signature: 's',
      timestamp: 1,
      apiKey: 'k',
      cloudName: 'c',
    });
    let n = 0;
    mocks.upload.mockImplementation(async () => url(++n));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('luồng thành công', () => {
    it('nén từng ảnh RỒI mới tải lên, và tải lên bản ĐÃ NÉN chứ không phải file gốc', async () => {
      const { user, onChange, input } = setup();
      const original = makeFile('IMG_1.jpg');

      await user.upload(input, original);

      await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
      expect(mocks.compress).toHaveBeenCalledWith(original);
      const uploaded = mocks.upload.mock.calls[0][0] as File;
      expect(uploaded).not.toBe(original);
      expect(uploaded.name).toBe('c-IMG_1.jpg');
      expect(onChange).toHaveBeenCalledWith([url(1)]);
    });

    it('nhiều ảnh: xử lý tuần tự theo thứ tự chọn, mỗi ảnh một chữ ký riêng, nối vào sau ảnh đã có', async () => {
      const { user, onChange, input } = setup([url(100)]);
      const order: string[] = [];
      mocks.compress.mockImplementation(async (file: File) => {
        order.push(`compress:${file.name}`);
        return new File(['c'], file.name, { type: 'image/webp' });
      });
      mocks.mutateAsync.mockImplementation(async () => {
        order.push('sign');
        return { signature: 's', timestamp: 1, apiKey: 'k', cloudName: 'c' };
      });
      mocks.upload.mockImplementation(async (file: File) => {
        order.push(`upload:${file.name}`);
        return `https://x/${file.name}`;
      });

      await user.upload(input, [makeFile('a.jpg'), makeFile('b.png', 'image/png')]);

      await waitFor(() => expect(onChange).toHaveBeenCalled());
      expect(order).toEqual([
        'compress:a.jpg',
        'sign',
        'upload:a.jpg',
        'compress:b.png',
        'sign',
        'upload:b.png',
      ]);
      expect(onChange).toHaveBeenCalledWith([url(100), 'https://x/a.jpg', 'https://x/b.png']);
    });

    it('đang xử lý: nút chuyển sang "Đang tải lên..." và bị khoá, xong thì mở lại', async () => {
      const { user, onChange, input } = setup();
      let release!: () => void;
      mocks.upload.mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            release = () => resolve(url(1));
          }),
      );

      await user.upload(input, makeFile('a.jpg'));

      expect(await screen.findByRole('button', { name: 'Đang tải lên...' })).toBeDisabled();
      release();
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: 'Thêm ảnh' })).toBeEnabled();
    });

    it('đúng ở biên: đã có 6 ảnh, chọn thêm 2 ⇒ vừa đủ tối đa, được phép', async () => {
      const { user, onChange, input } = setup(
        Array.from({ length: PRODUCT_VARIANT_MAX_IMAGES - 2 }, (_, i) => url(i)),
      );

      await user.upload(input, [makeFile('a.jpg'), makeFile('b.jpg')]);

      await waitFor(() => expect(onChange).toHaveBeenCalled());
      expect((onChange.mock.calls[0][0] as string[]).length).toBe(PRODUCT_VARIANT_MAX_IMAGES);
    });
  });

  describe('từ chối lựa chọn TRƯỚC khi xử lý bất cứ gì', () => {
    async function expectNothingProcessed() {
      // Chờ hết việc đang treo rồi mới khẳng định "không gọi" — kiểm "không gọi" ngay sau thao tác luôn đúng
      // dù code sai (rules/frontend.md mục 8).
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mocks.compress).not.toHaveBeenCalled();
      expect(mocks.mutateAsync).not.toHaveBeenCalled();
      expect(mocks.upload).not.toHaveBeenCalled();
    }

    it('sai định dạng (gif): báo lỗi, không nén/ký/tải', async () => {
      const { user, onChange, input } = setup();

      await user.upload(input, makeFile('anim.gif', 'image/gif'));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Chỉ nhận ảnh JPEG, PNG hoặc WebP',
      );
      await expectNothingProcessed();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('quá 10 MB: báo lỗi kèm TÊN file và giới hạn', async () => {
      const { user, onChange, input } = setup();

      await user.upload(input, makeFile('anh-to.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Ảnh "anh-to.jpg" lớn hơn 10 MB, hãy chọn ảnh nhỏ hơn',
      );
      await expectNothingProcessed();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('đúng 10 MB: được phép (biên)', async () => {
      const { user, onChange, input } = setup();

      await user.upload(input, makeFile('vua-du.jpg', 'image/jpeg', 10 * 1024 * 1024));

      await waitFor(() => expect(onChange).toHaveBeenCalled());
    });

    it('vượt số ảnh tối đa: báo lỗi kèm con số, không xử lý ảnh nào', async () => {
      const { user, onChange, input } = setup(
        Array.from({ length: PRODUCT_VARIANT_MAX_IMAGES - 1 }, (_, i) => url(i)),
      );

      await user.upload(input, [makeFile('a.jpg'), makeFile('b.jpg')]);

      expect(await screen.findByRole('alert')).toHaveTextContent('Mỗi biến thể tối đa 9 ảnh');
      await expectNothingProcessed();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('chọn nhiều file mà MỘT file sai: từ chối cả lượt, không tải file hợp lệ nào', async () => {
      const { user, onChange, input } = setup();

      await user.upload(input, [
        makeFile('ok.jpg'),
        makeFile('bad.gif', 'image/gif'),
        makeFile('ok2.png', 'image/png'),
      ]);

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      await expectNothingProcessed();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('tên file rất dài trong thông báo được cắt gọn (không đẩy vỡ bố cục)', async () => {
      const { user, input } = setup();
      const longName = `${'a'.repeat(300)}.jpg`;

      await user.upload(input, makeFile(longName, 'image/jpeg', 11 * 1024 * 1024));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent?.length).toBeLessThan(120);
      expect(alert.textContent).toContain('…');
    });

    it('lần chọn hợp lệ sau đó xoá lỗi cũ', async () => {
      const { user, onChange, input } = setup();
      await user.upload(input, makeFile('bad.gif', 'image/gif'));
      expect(await screen.findByRole('alert')).toBeInTheDocument();

      await user.upload(input, makeFile('ok.jpg'));

      await waitFor(() => expect(onChange).toHaveBeenCalled());
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('lỗi khi xử lý', () => {
    it('không đọc được ảnh (ImageProcessingError): báo đúng tên file, không tải ảnh đó lên', async () => {
      const { user, onChange, input } = setup();
      mocks.compress.mockRejectedValue(new ImageProcessingError('hong.jpg'));

      await user.upload(input, makeFile('hong.jpg'));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Không đọc được ảnh "hong.jpg", hãy thử ảnh khác',
      );
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Thêm ảnh' })).toBeEnabled();
    });

    it('tải lên Cloudinary lỗi: hiện thông báo chung và không thêm ảnh nào', async () => {
      const { user, onChange, input } = setup();
      mocks.upload.mockRejectedValue(new Error('upload lỗi'));

      await user.upload(input, makeFile('a.jpg'));

      expect(await screen.findByRole('alert')).toHaveTextContent('Tải ảnh thất bại, thử lại');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('lấy chữ ký lỗi: thông báo chung, không tải gì lên', async () => {
      const { user, input } = setup();
      mocks.mutateAsync.mockRejectedValue(new Error('401'));

      await user.upload(input, makeFile('a.jpg'));

      expect(await screen.findByRole('alert')).toHaveTextContent('Tải ảnh thất bại, thử lại');
      expect(mocks.upload).not.toHaveBeenCalled();
    });
  });

  describe('giao diện', () => {
    it('ô chọn file chỉ gợi ý JPEG/PNG/WebP (không còn image/*)', () => {
      const { input } = setup();

      expect(input.accept).toBe('image/jpeg,image/png,image/webp');
    });

    it('hiện gợi ý giới hạn kèm số ảnh đã có', () => {
      setup([url(1), url(2)]);

      expect(screen.getByText('JPEG, PNG, WebP · tối đa 10 MB · 2/9 ảnh')).toBeInTheDocument();
    });

    it('đã đủ số ảnh tối đa: nút thêm ảnh bị khoá', () => {
      setup(Array.from({ length: PRODUCT_VARIANT_MAX_IMAGES }, (_, i) => url(i)));

      expect(screen.getByRole('button', { name: 'Thêm ảnh' })).toBeDisabled();
    });

    it('còn chỗ: nút thêm ảnh mở', () => {
      setup(Array.from({ length: PRODUCT_VARIANT_MAX_IMAGES - 1 }, (_, i) => url(i)));

      expect(screen.getByRole('button', { name: 'Thêm ảnh' })).toBeEnabled();
    });

    // Dữ liệu cũ từ trước khi có trần (vd 12 ảnh): vẫn hiển thị đủ và xoá bớt được, chỉ không THÊM được nữa — API
    // cũng cho lưu miễn không tăng số ảnh (ProductService.assertImageLimit, "grandfather").
    describe('biến thể cũ ĐÃ vượt trần (12 ảnh)', () => {
      const legacy = Array.from({ length: 12 }, (_, i) => url(i));

      it('hiện đủ 12 ảnh, bộ đếm báo đúng số thật, nút thêm ảnh khoá', () => {
        const { container } = setup(legacy);

        expect(container.querySelectorAll('ul li')).toHaveLength(12);
        expect(screen.getByText('JPEG, PNG, WebP · tối đa 10 MB · 12/9 ảnh')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Thêm ảnh' })).toBeDisabled();
      });

      it('vẫn xoá được từng ảnh (để chủ động bớt xuống)', async () => {
        const { user, onChange } = setup(legacy);

        await user.click(screen.getAllByRole('button', { name: 'Xoá ảnh' })[0]);

        expect(onChange).toHaveBeenCalledWith(legacy.slice(1));
      });

      it('chọn thêm ảnh vẫn bị từ chối (không tăng thêm khi đã vượt trần)', async () => {
        const { user, onChange, input } = setup(legacy);

        await user.upload(input, makeFile('moi.jpg'));

        expect(await screen.findByRole('alert')).toHaveTextContent('Mỗi biến thể tối đa 9 ảnh');
        expect(onChange).not.toHaveBeenCalled();
      });
    });

    it('bản en: gợi ý và lỗi bằng tiếng Anh', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup({ applyAccept: false });
      const { container } = render(
        withIntl(<VariantImagesUpload value={[]} onChange={onChange} {...LABELS} />, 'en'),
      );
      expect(screen.getByText('JPEG, PNG, WebP · up to 10 MB · 0/9 images')).toBeInTheDocument();

      await user.upload(
        container.querySelector('input[type="file"]') as HTMLInputElement,
        makeFile('x.gif', 'image/gif'),
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Only JPEG, PNG or WebP images are accepted',
      );
    });
  });
});
