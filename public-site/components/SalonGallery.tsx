'use client';

import Carousel from './Carousel';
import { Spark, IcCamera } from './icons';

const SALON_PHOTOS = [
  { id: 'salon-1', caption: 'Зона стрижки и укладки', tag: 'Волосы' },
  { id: 'salon-2', caption: 'Маникюрный кабинет', tag: 'Ногти' },
  { id: 'salon-3', caption: 'Уютная зона ожидания', tag: 'Интерьер' },
  { id: 'salon-4', caption: 'Кабинет солярия', tag: 'Солярий' },
  { id: 'salon-5', caption: 'Ресепшен и приём гостей', tag: 'Интерьер' },
];

export default function SalonGallery() {
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
          items={SALON_PHOTOS}
          baseWidth={620}
          gap={30}
          ariaLabel="Фотографии салона"
          renderItem={(p) => (
            <figure className="salon-shot">
              <span className="tag">{p.tag}</span>
              <div className="shot-empty">
                <IcCamera />
                <span className="soon">Фото скоро</span>
              </div>
              <figcaption>{p.caption}</figcaption>
            </figure>
          )}
        />
      </div>
    </section>
  );
}
