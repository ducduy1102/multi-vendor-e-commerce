import { Skeleton } from '@/shared/components/ui/skeleton';

export function ShopFormFieldsSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-20 motion-reduce:animate-none" />
        <Skeleton className="h-8 w-full motion-reduce:animate-none" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-16 motion-reduce:animate-none" />
        <Skeleton className="h-16 w-full motion-reduce:animate-none" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-20 motion-reduce:animate-none" />
        <Skeleton className="h-8 w-full motion-reduce:animate-none" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24 motion-reduce:animate-none" />
        <Skeleton className="h-8 w-full motion-reduce:animate-none" />
      </div>
      <Skeleton className="h-8 w-full motion-reduce:animate-none" />
    </div>
  );
}
