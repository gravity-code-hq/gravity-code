import type { SVGProps } from "react";

export function GravityMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="260 260 504 504" fill="none" aria-hidden="true" {...props}>
      <path
        d="M403 366 L602 543 L403 698"
        stroke="currentColor"
        strokeWidth="100"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
