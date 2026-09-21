import { Link } from '@/i18n/navigation';
import type { Category } from '../types';

interface CategoryShortcutListProps {
  categories: Category[];
}

// Chỉ hiển thị category cấp cha (parentId === null) — shortcut trang chủ chỉ
// cần điều hướng nhanh tới nhóm ngành hàng lớn, không cần lồng cả cây phân
// cấp (category con chọn ở trang danh sách, Bước 3.4). Link trỏ tới
// /products?categoryId=... — route thật ở Bước 3.4.
export function CategoryShortcutList({ categories }: CategoryShortcutListProps) {
  const topLevelCategories = categories.filter((category) => category.parentId === null);

  if (topLevelCategories.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-3">
      {topLevelCategories.map((category) => (
        <Link
          key={category.id}
          href={{ pathname: '/products', query: { categoryId: category.id } }}
          className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
        >
          {category.name}
        </Link>
      ))}
    </div>
  );
}
