import { html } from "../runtime/vendor.js";

export function MoonIcon({ size = 16, strokeWidth = 2, className = "" } = {}) {
  const s = Number(size) > 0 ? Number(size) : 16;
  const sw = Number(strokeWidth) > 0 ? Number(strokeWidth) : 2;
  return html`
    <svg
      class=${className}
      width=${s}
      height=${s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width=${sw}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3a6 6 0 0 0 9 9a9 9 0 1 1-9-9Z"></path>
    </svg>
  `;
}

