import { getTranslations } from "next-intl/server";

import { VerifyEmailStatus } from "@/modules/auth";

interface VerifyEmailPageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { token } = await searchParams;
  const t = await getTranslations("auth");

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-sm">
        <h1 className="mb-6 text-center text-xl font-semibold">{t("verifyEmailTitle")}</h1>
        <VerifyEmailStatus token={typeof token === "string" ? token : null} />
      </div>
    </div>
  );
}
