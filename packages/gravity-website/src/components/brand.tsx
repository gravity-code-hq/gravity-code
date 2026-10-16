import type { SVGProps } from "react";

export function GravityMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" {...props}>
      <ellipse
        cx="24"
        cy="24"
        rx="21"
        ry="9"
        transform="rotate(-40 24 24)"
        stroke="currentColor"
        strokeWidth="2.8"
      />
      <ellipse
        cx="24"
        cy="24"
        rx="21"
        ry="9"
        transform="rotate(40 24 24)"
        stroke="currentColor"
        strokeWidth="2.8"
      />
      <circle cx="24" cy="24" r="4.5" fill="currentColor" />
    </svg>
  );
}

export function Brand({ href = "#home" }: { href?: string }) {
  return (
    <a className="brand" href={href} aria-label="Gravity home">
      <GravityMark />
      gravity<span className="brand-period">.</span>
    </a>
  );
}

export function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.54c.03 3.16 2.77 4.21 2.8 4.23-.02.07-.44 1.5-1.45 2.98-.88 1.28-1.79 2.56-3.23 2.58-1.42.03-1.88-.83-3.51-.83-1.62 0-2.13.81-3.48.86-1.39.05-2.45-1.39-3.34-2.67C3.03 17.07 1.64 12.29 3.5 9.07c.92-1.6 2.57-2.61 4.36-2.63 1.37-.02 2.66.93 3.5.93.83 0 2.39-1.15 4.03-.98.69.03 2.62.28 3.86 2.1-.1.06-2.3 1.34-2.27 4.05h.07zM14.39 4.67c.74-.89 1.24-2.12 1.11-3.35-1.07.04-2.36.71-3.13 1.6-.69.79-1.3 2.05-1.14 3.26 1.19.09 2.41-.61 3.16-1.51z" />
    </svg>
  );
}
