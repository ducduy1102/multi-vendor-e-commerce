import { getTranslations } from "next-intl/server";

import { VerifyEmailStatus } from "@/modules/auth";
import { AuthCard } from "@/shared/components/AuthCard";

interface VerifyEmailPageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { token } = await searchParams;
  const t = await getTranslations("auth");

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <AuthCard>
        <h1 className="mb-6 text-center text-xl font-semibold">{t("verifyEmailTitle")}</h1>
        <VerifyEmailStatus token={typeof token === "string" ? token : null} />
      </AuthCard>
    </div>
  );
}
