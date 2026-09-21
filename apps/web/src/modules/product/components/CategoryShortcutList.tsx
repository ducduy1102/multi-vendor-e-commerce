import { Link } from '@/i18n/navigation';
import type { Category } from '../types';

interface CategoryShortcutListProps {
  // Đã lọc sẵn category cấp cha (getTopLevelCategories, tính 1 lần ở
  // page.tsx) — component này KHÔNG tự lọc lại, chỉ trình bày. Caller chịu
  // trách nhiệm không render component này khi mảng rỗng (page.tsx đã ẩn
  // cả section "Danh mục nổi bật" trong trường hợp đó).
  categories: Category[];
}

// Link trỏ tới /products?categoryId=... — route thật ở Bước 3.4.
export function CategoryShortcutList({ categories }: CategoryShortcutListProps) {
  if (categories.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-3">
      {categories.map((category) => (
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
