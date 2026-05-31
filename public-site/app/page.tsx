import Image from 'next/image';
import { getPublicMasters, getServices, getMasterServices, servicePrices } from '@/lib/data';
import BookingWidget from '@/components/BookingWidget';

export default async function Home() {
  const masters = await getPublicMasters();
  const services = await getServices();
  const masterServices = await getMasterServices();
  
  const prices = servicePrices(services, masterServices, masters.map((m) => m.id));

  return (
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      <section className="hero" style={{ textAlign: 'center', margin: '4rem 0' }}>
        <h1 style={{ fontSize: '4rem', marginBottom: '1rem', color: 'var(--accent-deep)' }}>Nicole Beauty</h1>
        <p style={{ fontSize: '1.5rem', color: 'var(--muted)' }}>Ваша красота в надежных руках</p>
      </section>
      
      <section className="masters" style={{ marginBottom: '4rem' }}>
        <h2 style={{ fontSize: '2.5rem', marginBottom: '2rem', borderBottom: '1px solid var(--hairline)', paddingBottom: '1rem' }}>Наши мастера</h2>
        <div className="masters-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '2rem' }}>
          {masters.map((m) => (
            <div key={m.id} className="master-card" style={{ background: 'var(--bg-elevated)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
              {m.photo_url ? (
                <div style={{ position: 'relative', width: '100%', height: '250px' }}>
                  <Image src={m.photo_url} alt={m.name} fill sizes="(max-width: 600px) 100vw, 300px" style={{ objectFit: 'cover' }} />
                </div>
              ) : (
                <div style={{ width: '100%', height: '250px', background: 'var(--hairline)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>Нет фото</div>
              )}
              <div style={{ padding: '1.5rem' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.5rem' }}>{m.name}</h3>
                <p style={{ margin: '0 0 1rem 0', color: 'var(--accent-deep)', fontWeight: '500' }}>{m.specialty}</p>
                {m.bio && <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: '0.95rem', lineHeight: '1.5' }}>{m.bio}</p>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="services" style={{ marginBottom: '4rem' }}>
        <h2 style={{ fontSize: '2.5rem', marginBottom: '2rem', borderBottom: '1px solid var(--hairline)', paddingBottom: '1rem' }}>Услуги и цены</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
          {prices.map((p) => (
            <li key={p.service.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--hairline)' }}>
              <span style={{ fontWeight: '500' }}>{p.service.name}</span>
              <span style={{ color: 'var(--accent-deep)', fontWeight: 'bold' }}>{p.from ? `от ${p.from} ₽` : 'Цена по запросу'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="booking" style={{ marginBottom: '4rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <h2 style={{ fontSize: '2.5rem', marginBottom: '2rem', textAlign: 'center' }}>Запись</h2>
        <BookingWidget 
          services={services} 
          masters={masters} 
          masterServices={masterServices} 
          whatsappNumber={process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}
          telegramContact={process.env.NEXT_PUBLIC_TELEGRAM_CONTACT}
        />
      </section>
    </main>
  );
}
