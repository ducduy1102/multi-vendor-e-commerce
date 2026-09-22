'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Input } from '@/shared/components/ui/input';
import { Slider } from '@/shared/components/ui/slider';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';

const PRICE_DEBOUNCE_MS = 500;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

interface PriceRangeFilterProps {
  min: number;
  max: number;
  step: number;
  initialValue: readonly [number, number];
  onChange: (value: [number, number]) => void;
}

// Slider 2 đầu (kéo nhanh) + input số bên cạnh (gõ chính xác), đồng bộ 2
// chiều qua chung 1 state `range`: kéo slider cập nhật input, gõ input hợp
// lệ cập nhật slider. Debounce PRICE_DEBOUNCE_MS trước khi gọi `onChange`
// (đổi query param -> gọi lại listProducts) — áp dụng cho cả kéo slider lẫn
// gõ input, tránh gọi API liên tục theo từng bước kéo/từng phím gõ.
export function PriceRangeFilter({
  min,
  max,
  step,
  initialValue,
  onChange,
}: PriceRangeFilterProps) {
  const t = useTranslations('product');
  const [range, setRange] = useState<[number, number]>([initialValue[0], initialValue[1]]);
  const debouncedRange = useDebouncedValue(range, PRICE_DEBOUNCE_MS);

  // Bỏ qua lần chạy đầu (mount) — chỉ gọi onChange khi range THỰC SỰ đổi do
  // người dùng tương tác, không gọi lại ngay với giá trị initialValue đã có
  // sẵn trong URL.
  const isFirstRender = useRef(true);
  // Cập nhật ref trong effect (không phải lúc render) — react-hooks/refs
  // chặn ghi ref trực tiếp trong render, dù đây là pattern "luôn giữ bản mới
  // nhất" phổ biến, chỉ để tránh phải liệt kê `onChange` (identity đổi mỗi
  // render ở cha) vào dependency của effect debounce bên dưới.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onChangeRef.current(debouncedRange);
  }, [debouncedRange]);

  function handleMinInputChange(text: string) {
    const parsed = Number(text);
    if (text.trim() === '' || Number.isNaN(parsed)) {
      return;
    }
    setRange(([, currentMax]) => [clamp(parsed, min, currentMax), currentMax]);
  }

  function handleMaxInputChange(text: string) {
    const parsed = Number(text);
    if (text.trim() === '' || Number.isNaN(parsed)) {
      return;
    }
    setRange(([currentMin]) => [currentMin, clamp(parsed, currentMin, max)]);
  }

  return (
    <div className="flex flex-col gap-2">
      <Slider
        min={min}
        max={max}
        step={step}
        value={range}
        onValueChange={(value) => setRange(value as [number, number])}
        className="w-full"
      />
      <div className="flex items-center gap-2">
        <Input
          type="number"
          aria-label={t('filterMinPriceLabel')}
          className="min-w-0 flex-1"
          min={min}
          max={range[1]}
          step={step}
          value={range[0]}
          onChange={(event) => handleMinInputChange(event.target.value)}
        />
        <span className="text-sm text-muted-foreground">–</span>
        <Input
          type="number"
          aria-label={t('filterMaxPriceLabel')}
          className="min-w-0 flex-1"
          min={range[0]}
          max={max}
          step={step}
          value={range[1]}
          onChange={(event) => handleMaxInputChange(event.target.value)}
        />
      </div>
    </div>
  );
}
