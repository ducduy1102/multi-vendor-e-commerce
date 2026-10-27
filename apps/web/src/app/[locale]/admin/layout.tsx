import { AdminNav } from '@/modules/admin';
import { Container } from '@/shared/components/Container';

// Khung chung của khu /admin/* (tổng quan, duyệt shop, hoàn tiền; Week11.md 2.6): thanh điều hướng + vùng nội dung.
// Dưới `lg` là cột đơn (tab ngang trên, nội dung dưới), từ `lg` là hai cột (sidebar 224px + nội dung). Mỗi trang con
// chỉ ghép phần nội dung của nó (tiêu đề + khối chính) — `<main>` là của layout nên trang con KHÔNG tự bọc <main> hay
// Container nữa. Bảo vệ ở proxy.ts (/admin/* — role đọc từ JWT, chỉ để điều hướng) và quyền thật ở RolesGuard của BE;
// không tự kiểm tra lại ở đây — như /account.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <Container className="flex flex-1 flex-col gap-4 py-6 sm:py-10 lg:flex-row lg:gap-8">
        <AdminNav />
        <main className="flex min-w-0 flex-1 flex-col gap-6">{children}</main>
      </Container>
    </div>
  );
}
