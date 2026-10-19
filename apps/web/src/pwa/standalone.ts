/**
 * True when running as an installed app ("Add to Home Screen") rather than in a browser tab.
 * iOS reports it through `navigator.standalone`; everything else through the display mode.
 */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
