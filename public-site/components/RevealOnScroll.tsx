'use client';

import { useEffect } from 'react';

/* Adds `.in` to every `.reveal` element as it scrolls into view, driving the
   cascade fade-up animation. Mounted once near the page root. */
export default function RevealOnScroll() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal:not(.in)');
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return null;
}
