interface ChotMarkProps {
  className?: string;
}

// Màu badge/vòng/then cố định theo đúng .claude/icon/chot-icon.svg — không
// đổi theo theme sáng/tối (giống icon app Slack/Spotify, không phải màu nền
// UI cần tương phản). Chỉ chữ "chốt" cạnh icon mới cần đổi màu theo theme
// (xem token `--brand` trong globals.css), vì nó nằm trực tiếp trên nền
// header chứ không nằm trong khối badge này.
export function ChotMark({ className }: ChotMarkProps) {
  return (
    <svg viewBox="0 0 96 96" className={className} aria-hidden="true">
      <rect width="96" height="96" rx="21" fill="#0F766E" />
      <g transform="translate(13.44,13.44) scale(0.72)">
        <path
          d="M70.9 31.9A28 28 0 1 0 70.9 64.1"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <rect x="58" y="41" width="32" height="14" rx="7" fill="#E8552B" />
      </g>
    </svg>
  );
}
