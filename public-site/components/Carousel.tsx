'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IcArrowLeft, IcArrowRight } from './icons';

/* Center-focus carousel: active card centered, neighbours peek under a
   gradient fade. Controls (dots + arrows) sit below. Supports drag/swipe
   and keyboard arrows when focused. */
export default function Carousel<T extends { id?: string | number }>({
  items,
  baseWidth = 380,
  gap = 26,
  renderItem,
  ariaLabel,
  initial = 1,
}: {
  items: T[];
  baseWidth?: number;
  gap?: number;
  renderItem: (item: T, isActive: boolean, index: number) => ReactNode;
  ariaLabel?: string;
  initial?: number;
}) {
  const [active, setActive] = useState(Math.min(initial, Math.max(0, items.length - 1)));
  const [offset, setOffset] = useState(0);
  const [cardW, setCardW] = useState(baseWidth);
  const viewportRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ on: false, startX: 0, dx: 0 });
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const last = items.length - 1;
  const clamp = (n: number) => Math.max(0, Math.min(last, n));

  useEffect(() => {
    const recalc = (idx = active) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const vw = vp.offsetWidth;
      const cw = Math.min(baseWidth, vw - 72);
      setCardW(cw);
      setOffset(vw / 2 - idx * (cw + gap) - cw / 2);
    };
    recalc();
    const on = () => recalc();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [active, items.length, baseWidth, gap]);

  const go = (n: number) => setActive(clamp(n));

  const onDown = (clientX: number) => {
    drag.current = { on: true, startX: clientX, dx: 0 };
    setDragging(true);
  };
  const onMove = (clientX: number) => {
    if (!drag.current.on) return;
    drag.current.dx = clientX - drag.current.startX;
    setDragDx(drag.current.dx);
  };
  const onUp = () => {
    if (!drag.current.on) return;
    const dx = drag.current.dx;
    drag.current.on = false;
    setDragging(false);
    setDragDx(0);
    const threshold = (cardW + gap) * 0.18;
    if (dx < -threshold) go(active + 1);
    else if (dx > threshold) go(active - 1);
  };

  return (
    <div className="carousel" aria-label={ariaLabel}>
      <div
        className="carousel-viewport"
        ref={viewportRef}
        onMouseDown={(e) => onDown(e.clientX)}
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onTouchStart={(e) => onDown(e.touches[0].clientX)}
        onTouchMove={(e) => onMove(e.touches[0].clientX)}
        onTouchEnd={onUp}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') go(active + 1);
          if (e.key === 'ArrowLeft') go(active - 1);
        }}
      >
        <span className="carousel-fade left" />
        <span className="carousel-fade right" />
        <div
          className="carousel-track"
          style={{
            transform: `translate3d(${offset + dragDx}px,0,0)`,
            transition: dragging ? 'none' : 'transform .6s cubic-bezier(.2,.7,.2,1)',
            gap: gap + 'px',
          }}
        >
          {items.map((it, i) => (
            <div
              key={it.id ?? i}
              className={'carousel-item' + (i === active ? ' active' : '')}
              style={{ flex: `0 0 ${cardW}px`, width: cardW + 'px' }}
              onClick={() => {
                if (i !== active) go(i);
              }}
              aria-hidden={i === active ? undefined : true}
            >
              {renderItem(it, i === active, i)}
            </div>
          ))}
        </div>
      </div>

      <div className="carousel-controls">
        <div className="carousel-dots">
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              className={'cdot' + (i === active ? ' on' : '')}
              aria-label={`Слайд ${i + 1}`}
              onClick={() => go(i)}
            />
          ))}
        </div>
        <div className="carousel-arrows">
          <button type="button" className="carr" aria-label="Назад" disabled={active === 0} onClick={() => go(active - 1)}>
            <IcArrowLeft />
          </button>
          <button type="button" className="carr" aria-label="Вперёд" disabled={active === last} onClick={() => go(active + 1)}>
            <IcArrowRight />
          </button>
        </div>
      </div>
    </div>
  );
}
