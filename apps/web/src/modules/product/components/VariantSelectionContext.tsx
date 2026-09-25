'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

import type { SelectedValues } from './VariantSelector.utils';

interface VariantSelectionContextValue {
  selectedValues: SelectedValues;
  select: (attributeName: string, value: string) => void;
}

const VariantSelectionContext = createContext<VariantSelectionContextValue | null>(null);

// Week5.md Bước 3.3 — gallery ảnh (ProductGallery, cell lưới bên trái) và
// giá/chọn thuộc tính (ProductVariantSection, cell lưới bên phải) là 2
// NHÁNH RIÊNG trong cây component (không lồng nhau), đều cần đọc chung
// `selectedValues` — nơi chung gần nhất của 2 nhánh là chính
// ProductDetailContainer (Server Component, không tự giữ được state). Dùng
// Context thay vì Zustand (rules/frontend.md mục 3 dành Zustand cho state
// chia sẻ nhiều COMPONENT/ROUTE — đây chỉ chia sẻ trong phạm vi 1 trang) —
// Provider bọc quanh children (kể cả h1/dl/mô tả viết trực tiếp trong
// ProductDetailContainer.tsx) mà KHÔNG kéo chúng vào client bundle, vì
// children được truyền qua prop `children`, không import vào file này.
export function VariantSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedValues, setSelectedValues] = useState<SelectedValues>({});

  function select(attributeName: string, value: string) {
    setSelectedValues((prev) => {
      const next = { ...prev };
      if (next[attributeName] === value) {
        delete next[attributeName];
      } else {
        next[attributeName] = value;
      }
      return next;
    });
  }

  return (
    <VariantSelectionContext.Provider value={{ selectedValues, select }}>
      {children}
    </VariantSelectionContext.Provider>
  );
}

export function useVariantSelection(): VariantSelectionContextValue {
  const context = useContext(VariantSelectionContext);
  if (!context) {
    throw new Error('useVariantSelection phải dùng bên trong VariantSelectionProvider');
  }
  return context;
}
