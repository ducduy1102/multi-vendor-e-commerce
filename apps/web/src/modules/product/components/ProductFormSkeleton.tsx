import { Skeleton } from '@/shared/components/ui/skeleton';
import { VARIANT_GRID_COLS } from './ProductForm';

export function ProductFormSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-24 motion-reduce:animate-none" />
          <Skeleton className="h-8 w-full motion-reduce:animate-none" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-16 motion-reduce:animate-none" />
          <Skeleton className="h-8 w-full motion-reduce:animate-none" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-28 motion-reduce:animate-none" />
          <Skeleton className="h-16 w-full motion-reduce:animate-none" />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-24 motion-reduce:animate-none" />
          <Skeleton className="h-7 w-32 motion-reduce:animate-none" />
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-40 motion-reduce:animate-none" />
            <Skeleton className="ml-auto size-7 shrink-0 motion-reduce:animate-none" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 w-32 motion-reduce:animate-none" />
            <Skeleton className="h-8 w-32 motion-reduce:animate-none" />
            <Skeleton className="h-7 w-28 motion-reduce:animate-none" />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-28 motion-reduce:animate-none" />
        <div className={`hidden gap-4 px-3 ${VARIANT_GRID_COLS} md:grid`}>
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-3 w-16 motion-reduce:animate-none" />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={index}
              className={`grid grid-cols-1 gap-3 rounded-lg border border-border p-3 ${VARIANT_GRID_COLS} md:items-start md:gap-4`}
            >
              <Skeleton className="h-4 w-24 motion-reduce:animate-none md:mt-1.5" />
              <Skeleton className="h-8 w-full motion-reduce:animate-none" />
              <Skeleton className="h-8 w-full motion-reduce:animate-none" />
              <Skeleton className="h-8 w-full motion-reduce:animate-none" />
              <Skeleton className="h-8 w-24 motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </div>

      <Skeleton className="h-8 w-32 motion-reduce:animate-none" />
    </div>
  );
}
