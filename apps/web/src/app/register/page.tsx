import { RegisterFormContainer } from "@/modules/auth";

export default function RegisterPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-sm">
        <h1 className="mb-6 text-xl font-semibold">Đăng ký</h1>
        <RegisterFormContainer />
      </div>
    </div>
  );
}
