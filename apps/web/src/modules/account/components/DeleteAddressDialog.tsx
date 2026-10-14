'use client';

import { useTranslations } from 'next-intl';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { Button } from '@/shared/components/ui/button';

interface DeleteAddressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Tên người nhận của địa chỉ sắp xoá — để người dùng biết đang xoá địa chỉ nào (danh sách có thể có
  // nhiều địa chỉ giống nhau về hình thức).
  recipientName: string;
  // Địa chỉ đang xoá là mặc định VÀ còn địa chỉ khác ⇒ BE tự chuyển mặc định sang địa chỉ thêm gần nhất
  // (AddressService.deleteAddress); nói trước để người dùng không bất ngờ. Chỉ ảnh hưởng một dòng chú ý.
  willPromoteAnother: boolean;
  isPending: boolean;
  onConfirm: () => void;
}

// Xoá địa chỉ là thao tác không hoàn tác được ⇒ bắt buộc xác nhận (rules/frontend.md mục 10; thay cho việc
// xoá thẳng như ghi chú cũ ở Week7). Nút xác nhận KHÔNG phải AlertDialogAction — action đó tự đóng hộp thoại
// ngay khi bấm, còn ở đây phải giữ hộp thoại mở (nút khoá) tới khi yêu cầu xong, giống CancelOrderDialog.
export function DeleteAddressDialog({
  open,
  onOpenChange,
  recipientName,
  willPromoteAnother,
  isPending,
  onConfirm,
}: DeleteAddressDialogProps) {
  const t = useTranslations('account');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {/* grid-cols-1: AlertDialogHeader là `grid` không khai cột nên có cột ngầm `auto` lấy min-content
            của con; câu mô tả chứa tên người nhận (≤ 100 ký tự, có thể không dấu cách) và `break-words`
            không hạ được min-content ⇒ hộp thoại rộng ~1300px ở 390px (đã đo bằng Playwright;
            rules/frontend.md mục 5). Primitive mới chỉ sửa ở AlertDialogContent, không ở Header. */}
        <AlertDialogHeader className="grid-cols-1">
          <AlertDialogTitle>{t('addressDeleteTitle')}</AlertDialogTitle>
          {/* w-full + break-words: tên người nhận do người dùng nhập, có thể là chuỗi dài không dấu cách. Header
              có place-items-center (không stretch) nên phần tử lấy ĐỘ RỘNG min-content = cả chuỗi; w-full ép nó
              rộng đúng bằng cột rồi break-words mới ngắt được dòng. */}
          <AlertDialogDescription className="w-full break-words">
            {t('addressDeleteDescription', { name: recipientName })}
          </AlertDialogDescription>
          {willPromoteAnother ? (
            <p className="text-sm font-medium text-foreground">{t('addressDeleteDefaultNote')}</p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{t('addressDeleteKeep')}</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={isPending} onClick={onConfirm}>
            {isPending ? t('addressDeleting') : t('addressDeleteConfirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
