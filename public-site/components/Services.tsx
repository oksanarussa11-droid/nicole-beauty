import { Spark } from './icons';
import type { ServicePrice } from '@/lib/data';

export default function Services({ prices }: { prices: ServicePrice[] }) {
  return (
    <section className="section" id="services">
      <div className="wrap">
        <div className="section-head">
          <div className="reveal">
            <span className="eyebrow"><Spark /> прайс-лист</span>
            <h2>Услуги <em>и цены</em></h2>
          </div>
          <p className="aside reveal" data-d="1">Точную стоимость рассчитает мастер с учётом длины волос, объёма работы и выбранных средств.</p>
        </div>
        <div className="svc-groups reveal">
          {prices.map((p) => (
            <div className="svc-row" key={p.service.id}>
              <span className="nm">{p.service.name}</span>
              <span className="dots" />
              <span className="pr">{p.from ? `от ${p.from.toLocaleString('ru-RU')} ₽` : 'по запросу'}</span>
            </div>
          ))}
        </div>
        <p className="svc-note reveal"><Spark /> Стоимость уточняйте при записи — мастер подберёт оптимальный вариант под ваш запрос и бюджет.</p>
      </div>
    </section>
  );
}
