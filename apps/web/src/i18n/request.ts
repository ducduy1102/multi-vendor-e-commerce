import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

// Chạy ở server cho mỗi request — quyết định locale thật sự dùng (fallback
// về defaultLocale nếu URL có prefix lạ không nằm trong routing.locales) và
// nạp đúng file messages tương ứng.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
