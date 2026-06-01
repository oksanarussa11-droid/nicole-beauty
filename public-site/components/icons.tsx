/* Line icons ported from the Nicole Beauty design system. */
import type { SVGProps } from 'react';

export const Spark = ({ s = 12 }: { s?: number }) => (
  <svg className="spark" width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 0c.6 6 5.4 11 11 12-5.6 1-10.4 6-11 12-.6-6-5.4-11-11-12 5.6-1 10.4-6 11-12z" />
  </svg>
);

const base = (props: SVGProps<SVGSVGElement>) => ({ viewBox: '0 0 24 24', 'aria-hidden': true, ...props });

export const IcInstagram = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="3" y="3" width="18" height="18" rx="5.2" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" /></svg>
);
export const IcTelegram = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"><path d="M22 3.2 2.6 10.7c-.74.28-.7 1.36.06 1.58l5.1 1.48 1.97 5.9c.22.64 1.04.78 1.46.26l2.66-3.16 4.96 3.66c.5.37 1.22.1 1.34-.52L23.5 4.1c.13-.66-.5-1.18-1.1-.9Z" /><path d="m7.9 13.9 10.2-7.1-7.4 8.2" /></svg>
);
export const IcWhats = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /><path d="M9 9c.3 2.7 2.3 4.7 5 5 .6.1 1.1-.5 1-1.1l-.2-.9-1.6-.4-.8.9c-.9-.5-1.6-1.2-2.1-2.1l.9-.8-.4-1.6-.9-.2C9.4 7.9 8.9 8.4 9 9z" /></svg>
);
export const IcPhone = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M5 3h3l2 5-2.5 1.5a11 11 0 005 5L19 12l5 2v3a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z" transform="translate(-1 0)" /></svg>
);
export const IcGlobe = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.5}><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3.2 12h17.6" /></svg>
);
export const IcPin = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z" /><circle cx="12" cy="10" r="2.4" /></svg>
);
export const IcClock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.5}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>
);
export const IcHeart = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M12 20s-7-4.6-9.2-9.1C1.3 7.9 3 5 6 5c2 0 3.2 1.3 4 2.5C10.8 6.3 12 5 14 5c3 0 4.7 2.9 3.2 5.9C19 15.4 12 20 12 20z" /></svg>
);
export const IcCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
);
export const IcScissors = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.5}><circle cx="6" cy="6" r="2.6" /><circle cx="6" cy="18" r="2.6" /><path d="M8.2 7.6L20 18M8.2 16.4L20 6" /></svg>
);
export const IcSun = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const IcMoon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" /></svg>
);
export const IcCamera = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round"><path d="M3 8.5A1.5 1.5 0 014.5 7H7l1.4-2h7.2L17 7h2.5A1.5 1.5 0 0121 8.5v9A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5v-9z" /><circle cx="12" cy="12.5" r="3.4" /></svg>
);
export const IcArrowLeft = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
);
export const IcArrowRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
);
