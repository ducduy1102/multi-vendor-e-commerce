import { cn } from '@/shared/lib/utils';

type ContainerProps = React.ComponentPropsWithoutRef<'div'>;

// Wrapper căn giữa dùng chung — 1 nguồn max-width/padding duy nhất cho
// Header và nội dung trang (trang chủ, /products), tránh mỗi nơi tự định
// nghĩa max-width khác nhau rồi lệch nhau theo thời gian. Luôn render
// <div> (không phải landmark) — nơi cần thẻ ngữ nghĩa (<main>, <header>)
// tự bọc Container bên trong, không thay thế nó.
export function Container({ className, ...props }: ContainerProps) {
  return <div className={cn('mx-auto w-full max-w-screen-xl px-4', className)} {...props} />;
}
