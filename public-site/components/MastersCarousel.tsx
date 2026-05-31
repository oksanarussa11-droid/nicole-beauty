'use client';

import Image from 'next/image';
import Carousel from './Carousel';
import { Spark } from './icons';
import type { Master } from '@/lib/data';

export default function MastersCarousel({ masters }: { masters: Master[] }) {
  return (
    <section className="section" id="masters">
      <div className="wrap">
        <div className="section-head">
          <div className="reveal">
            <span className="eyebrow"><Spark /> наша команда</span>
            <h2>Мастера, которым <em>доверяют</em></h2>
          </div>
          <p className="aside reveal" data-d="1">Каждый специалист Nicole Beauty — это опыт, вкус и внимание к деталям. Выберите своего мастера или доверьтесь нашему совету.</p>
        </div>
      </div>
      <div className="reveal">
        <Carousel
          items={masters}
          baseWidth={372}
          gap={28}
          ariaLabel="Мастера"
          renderItem={(m) => (
            <article className="master">
              <div className="ph">
                {m.specialty && <span className="tag">{m.specialty}</span>}
                {m.photo_url ? (
                  <div className="ph-media">
                    <Image src={m.photo_url} alt={m.name} fill sizes="(max-width: 680px) 80vw, 372px" style={{ objectFit: 'cover' }} />
                  </div>
                ) : (
                  <div className="ph-empty">{m.name}</div>
                )}
              </div>
              <div className="body">
                <h3>{m.name}</h3>
                {m.bio && <div className="role">{m.bio}</div>}
                <div className="line" />
              </div>
            </article>
          )}
        />
      </div>
    </section>
  );
}
