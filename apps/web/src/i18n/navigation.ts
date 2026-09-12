import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Dùng thay cho next/navigation, next/link trong toàn app — tự động thêm/bỏ
// prefix locale đúng theo `routing` (vd router.push("/") từ trang /en/login
// sẽ về "/en", không rơi về mặc định "vi" như next/navigation thường).
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
