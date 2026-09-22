import { Link } from '@/i18n/navigation';
import { getCategoryIcon } from '../constants/category-icons';
import type { Category } from '../types';
import { CATEGORY_GRID_CLASS } from './HomeCatalog.constants';

interface CategoryShortcutListProps {
  // Đã lọc sẵn category cấp cha (getTopLevelCategories, tính 1 lần ở
  // page.tsx) — component này KHÔNG tự lọc lại, chỉ trình bày. Caller chịu
  // trách nhiệm không render component này khi mảng rỗng (page.tsx đã ẩn
  // cả section "Danh mục" trong trường hợp đó).
  categories: Category[];
}

// Lưới icon tròn (thay bản pill cũ, "UI polish đợt 2" mục 6) — link trỏ
// tới /products?categoryId=.... auto-fill + cột rộng CỐ ĐỊNH (không dùng
// 1fr/minmax co giãn) + justify-start: khi chỉ có vài category, các ô giữ
// nguyên kích thước và dồn về đầu lưới thay vì bị kéo giãn lấp đầy hàng.
export function CategoryShortcutList({ categories }: CategoryShortcutListProps) {
  if (categories.length === 0) {
    return null;
  }

  return (
    <div className={CATEGORY_GRID_CLASS}>
      {categories.map((category) => {
        const Icon = getCategoryIcon(category.slug);
        return (
          <Link
            key={category.id}
            href={{ pathname: '/products', query: { categoryId: category.id } }}
            aria-label={category.name}
            className="group flex flex-col items-center gap-2 rounded-lg p-2 text-center outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
              <Icon className="size-6" aria-hidden="true" />
            </span>
            <span className="line-clamp-2 text-xs font-medium text-foreground">
              {category.name}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
