import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/shared/lib/utils"

// suppressHydrationWarning mặc định true: Chromium tự chèn
// style="caret-color:transparent" vào input nhận diện được qua autoComplete
// (name/email/password) khi form có ≥2 field kiểu này — chỉ xảy ra ở phía
// browser SAU khi React đã render xong, không phải do code render sai
// (React tự confirm "This won't be patched up", đúng use case chính thức
// của suppressHydrationWarning: DOM bị bên thứ 3 — browser/extension — chỉnh
// sau khi hydrate, không phải giá trị thật sự khác nhau giữa server/client).
function Input({
  className,
  type,
  suppressHydrationWarning = true,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      suppressHydrationWarning={suppressHydrationWarning}
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
