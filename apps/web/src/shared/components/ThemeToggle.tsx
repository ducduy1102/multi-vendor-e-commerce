'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';

// Không tự định vị "fixed" — component này giờ được ghép trực tiếp vào
// Header (shared/components/Header.tsx), Header quyết định vị trí (đúng
// cách LocaleSwitcher đã làm từ trước).
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useTranslations('common');

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
      <span className="sr-only">{t('toggleTheme')}</span>
    </Button>
  );
}
