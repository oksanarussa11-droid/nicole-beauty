'use client';

import Image from 'next/image';
import Carousel from './Carousel';
import { Spark, IcCamera } from './icons';
import type { GalleryItem } from '@/lib/data';

export default function SalonGallery({ items }: { items: GalleryItem[] }) {
  if (!items || items.length === 0) return null;

  return (
    <section className="section band" id="salon">
      <div className="wrap">
        <div className="section-head">
          <div className="reveal">
            <span className="eyebrow"><Spark /> атмосфера</span>
            <h2>Загляните <em>к нам</em></h2>
          </div>
          <p className="aside reveal" data-d="1">Светлый, уютный интерьер, где приятно проводить время. Добро пожаловать в пространство красоты Nicole Salon.</p>
        </div>
      </div>
      <div className="reveal">
        <Carousel
          items={items}
          baseWidth={620}
          gap={30}
          ariaLabel="Фотографии салона"
          renderItem={(p) => (
            <figure className="salon-shot">
              {p.tag && <span className="tag">{p.tag}</span>}
              {p.image_url ? (
                <Image
                  src={p.image_url}
                  alt={p.caption || 'Фото салона'}
                  fill
                  sizes="(max-width: 680px) 80vw, 620px"
                  style={{ objectFit: 'cover' }}
                />
              ) : (
                <div className="shot-empty">
                  <IcCamera />
                  <span className="soon">Фото скоро</span>
                </div>
              )}
              {p.caption && <figcaption>{p.caption}</figcaption>}
            </figure>
          )}
        />
      </div>
    </section>
  );
}
