import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { RegisterFormContainer } from "@/modules/auth";
import { AuthCard } from "@/shared/components/AuthCard";
import { ChotMark } from "@/shared/components/ChotMark";

export default async function RegisterPage() {
  // 2 await độc lập — Promise.all thay vì await nối tiếp
  // (vercel-react-best-practices, async-parallel).
  const [t, tHeader] = await Promise.all([getTranslations("auth"), getTranslations("header")]);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <AuthCard>
        <Link href="/" className="mb-6 flex items-center justify-center gap-1.5">
          <ChotMark className="size-7 shrink-0" />
          <span className="font-semibold text-brand">{tHeader("siteName")}</span>
        </Link>
        <h1 className="mb-6 text-xl font-semibold">{t("registerTitle")}</h1>
        <RegisterFormContainer />
      </AuthCard>
    </div>
  );
}
