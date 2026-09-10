"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/shared/components/ui/button";

import { logout } from "../services/auth.service";
import { useAuthStore } from "../store/auth.store";

export function LogoutButton() {
  const router = useRouter();
  const clearUser = useAuthStore((state) => state.clearUser);
  const [isLoading, setIsLoading] = useState(false);

  async function handleLogout() {
    setIsLoading(true);
    try {
      await logout();
    } finally {
      clearUser();
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <Button variant="outline" onClick={handleLogout} disabled={isLoading}>
      {isLoading ? "Đang đăng xuất..." : "Đăng xuất"}
    </Button>
  );
}
