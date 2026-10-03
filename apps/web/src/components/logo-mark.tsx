import { cn } from '@/lib/utils';

/**
 * The app's mark: two coins sharing one overlap, with a rupee where they meet. Drawn without a
 * background so it sits on any colour; the app icon (public/logo.svg) is the same artwork on a
 * teal tile. `animated` slides the coins together once (the splash screen uses it).
 */
export function LogoMark({
  className,
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  return (
    <svg
      viewBox="96 146 320 220"
      className={cn('h-auto', className)}
      aria-hidden="true"
      focusable="false"
    >
      <g className={animated ? 'logo-coin-left' : undefined}>
        <circle cx="206" cy="256" r="100" fill="#5eead4" />
      </g>
      <g className={animated ? 'logo-coin-right' : undefined}>
        <circle cx="306" cy="256" r="100" fill="#fdba74" />
      </g>
      <g className={animated ? 'logo-lens' : undefined}>
        <path d="M256 169.4A100 100 0 0 1 256 342.6A100 100 0 0 1 256 169.4Z" fill="#ffffff" />
        <path
          d="M231 214H281M231 236H281M236 214h14a21 21 0 0 1 0 42h-14l38 44"
          fill="none"
          stroke="#0b5a54"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
