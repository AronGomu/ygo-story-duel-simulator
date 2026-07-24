const FOCUSABLE_SELECTOR =
  "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function trapTabWithin(root: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (!focusable.includes(document.activeElement as HTMLElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
