import { VerifyEmailStatus } from "@/modules/auth";

interface VerifyEmailPageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { token } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-sm">
        <h1 className="mb-6 text-center text-xl font-semibold">Xác thực email</h1>
        <VerifyEmailStatus token={typeof token === "string" ? token : null} />
      </div>
    </div>
  );
}
