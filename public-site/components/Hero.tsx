import { Spark } from './icons';

export default function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero-bg">
        <span className="glow" />
        <span className="glow b" />
        <svg className="hero-arcs" viewBox="0 0 760 760" aria-hidden>
          {[370, 300, 232, 165].map((r) => (
            <circle key={r} cx="380" cy="380" r={r} />
          ))}
        </svg>
      </div>
      <div className="wrap hero-inner">
        <div className="reveal in">
          <span className="sprig">
            <svg width="58" height="20" viewBox="0 0 88 28" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
              <path d="M44 5v20" />
              <path d="M44 10c-5 0-9 2-12 5M44 10c5 0 9 2 12 5M44 17c-4 0-7 1.4-9.5 4M44 17c4 0 7 1.4 9.5 4" />
              <circle cx="44" cy="4" r="1.6" fill="currentColor" stroke="none" />
            </svg>
          </span>
        </div>
        <span className="eyebrow reveal in" data-d="1"><span className="ln" /><Spark /> салон красоты в Самаре <span className="ln" /></span>
        <h1 className="reveal in" data-d="2"><span className="l1">Nicole</span> <em>Beauty</em></h1>
        <p className="lede reveal in" data-d="3">Ваша красота — в надёжных руках.</p>
        <div className="meta reveal in" data-d="3">
          <span>Волосы</span><span className="dot" /><span>Ногти</span><span className="dot" /><span>Брови &amp; ресницы</span><span className="dot" /><span>Косметология</span><span className="dot" /><span>Солярий</span>
        </div>
        <div className="cta-row reveal in" data-d="4">
          <a href="#booking" className="btn btn-primary btn-lg">Записаться онлайн</a>
          <a href="#masters" className="btn btn-ghost btn-lg">Наши мастера</a>
        </div>
      </div>
    </section>
  );
}
