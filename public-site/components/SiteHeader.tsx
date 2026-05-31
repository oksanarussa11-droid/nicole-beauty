'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import BrandMark from './BrandMark';
import { IcSun, IcMoon } from './icons';

type Theme = 'champagne' | 'noir';

const THEME_EVENT = 'nb-theme-change';

// Theme lives on <html data-theme> (set pre-paint by the bootstrap script).
// Reading it through an external store keeps SSR ('champagne') and the client
// in sync with no hydration mismatch and no setState-in-effect.
function subscribeTheme(cb: () => void) {
  window.addEventListener(THEME_EVENT, cb);
  return () => window.removeEventListener(THEME_EVENT, cb);
}
function getThemeSnapshot(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'noir' ? 'noir' : 'champagne';
}
function getServerTheme(): Theme {
  return 'champagne';
}

export default function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerTheme);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === 'noir' ? 'champagne' : 'noir';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('nb-theme', next);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  };

  const isDark = theme === 'noir';

  return (
    <header className={'site-header' + (scrolled ? ' scrolled' : '')}>
      <BrandMark />
      <nav className="nav">
        <a href="#masters">Мастера</a>
        <a href="#salon">Салон</a>
        <a href="#services">Услуги</a>
        <a href="#booking">Запись</a>
        <a href="#contacts">Контакты</a>
      </nav>
      <div className="nav-actions">
        <button
          className={'theme-toggle' + (isDark ? ' dark' : '')}
          onClick={toggleTheme}
          role="switch"
          aria-checked={isDark}
          aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
          title={isDark ? 'Светлая тема' : 'Тёмная тема'}
        >
          <span className="tt-ic sun"><IcSun /></span>
          <span className="tt-ic moon"><IcMoon /></span>
          <span className="tt-knob" />
        </button>
        <a href="#booking" className="btn btn-primary">Записаться</a>
      </div>
    </header>
  );
}
