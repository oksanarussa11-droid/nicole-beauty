'use client';

import { useState } from 'react';

type Service = {
  id: number;
  name: string;
};

type Master = {
  id: number;
  name: string;
};

type MasterService = {
  master_id: number;
  service_id: number;
  price: number | string | null;
};

const contactMethods = ['whatsapp', 'telegram', 'phone'] as const;
type ContactMethod = (typeof contactMethods)[number];

type YandexMetrica = (counterId: number, method: 'reachGoal', target: string) => void;

declare global {
  interface Window {
    ym?: YandexMetrica;
  }
}

function isContactMethod(value: string): value is ContactMethod {
  return contactMethods.includes(value as ContactMethod);
}

export default function BookingWidget({
  services,
  masters,
  masterServices,
  whatsappNumber,
  telegramContact
}: {
  services: Service[];
  masters: Master[];
  masterServices: MasterService[];
  whatsappNumber?: string;
  telegramContact?: string;
}) {
  const [serviceId, setServiceId] = useState('');
  const [masterId, setMasterId] = useState('');
  const [helpChoosing, setHelpChoosing] = useState(false);
  const [day, setDay] = useState('');
  const [period, setPeriod] = useState('');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [contactMethod, setContactMethod] = useState<ContactMethod>('whatsapp');
  const [note, setNote] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Derive available masters for selected service
  const availableMasters = serviceId 
    ? masters.filter(m => masterServices.some(ms => ms.master_id === m.id && ms.service_id === Number(serviceId) && Number(ms.price) > 0))
    : masters;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    // reachGoal('cta_click')
    if (typeof window !== 'undefined' && window.ym) {
      const ymId = process.env.NEXT_PUBLIC_YANDEX_METRICA_ID;
      if (ymId) {
        window.ym(Number(ymId), 'reachGoal', 'cta_click');
      }
    }

    if (!name.trim() || !contact.trim()) {
      setError('Пожалуйста, укажите имя и контакт');
      return;
    }
    
    if (!serviceId) {
      setError('Пожалуйста, выберите услугу');
      return;
    }

    setLoading(true);
    try {
      const selectedService = services.find(s => s.id === Number(serviceId));
      const selectedMaster = masters.find(m => m.id === Number(masterId));

      const payload = {
        service_id: Number(serviceId) || null,
        service_name: selectedService?.name || null,
        master_id: helpChoosing ? null : Number(masterId) || null,
        master_name: helpChoosing ? 'Помогите выбрать' : (selectedMaster?.name || null),
        help_choosing: helpChoosing,
        preferred_day: day,
        preferred_period: period,
        client_name: name,
        client_contact: contact,
        contact_method: contactMethod,
        note
      };

      const res = await fetch('/api/booking-create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Ошибка при отправке заявки');
      }

      setSuccess(true);
      
      // reachGoal('request_sent')
      if (typeof window !== 'undefined' && window.ym) {
        const ymId = process.env.NEXT_PUBLIC_YANDEX_METRICA_ID;
        if (ymId) {
          window.ym(Number(ymId), 'reachGoal', 'request_sent');
        }
      }

      // Open deep link
      if (contactMethod === 'whatsapp' && whatsappNumber) {
        window.open(`https://wa.me/${whatsappNumber.replace(/[^0-9]/g, '')}`, '_blank');
      } else if (contactMethod === 'telegram' && telegramContact) {
        window.open(`https://t.me/${telegramContact.replace('@', '')}`, '_blank');
      }
      
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Произошла ошибка');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="booking-success" style={{ padding: '2rem', background: 'var(--positive-bg)', borderRadius: '8px', color: 'var(--positive)' }}>
        <h3>Заявка успешно отправлена!</h3>
        <p>Мы свяжемся с вами в ближайшее время для подтверждения записи.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="booking-form" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '500px', background: 'var(--bg-elevated)', padding: '2rem', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
      {error && <div style={{ color: 'var(--danger)', padding: '0.5rem', background: '#ffebee', borderRadius: '4px' }}>{error}</div>}
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label>Имя *</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} required style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--hairline)' }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label>Номер телефона или ник в мессенджере *</label>
        <input type="text" value={contact} onChange={e => setContact(e.target.value)} required style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--hairline)' }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label>Удобный способ связи</label>
        <select value={contactMethod} onChange={e => {
          if (isContactMethod(e.target.value)) setContactMethod(e.target.value);
        }} style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--hairline)' }}>
          <option value="whatsapp">WhatsApp</option>
          <option value="telegram">Telegram</option>
          <option value="phone">Звонок</option>
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label>Услуга *</label>
        <select value={serviceId} onChange={e => {
          setServiceId(e.target.value);
          setMasterId('');
        }} required style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--hairline)' }}>
          <option value="">Выберите услугу...</option>
          {services.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label>Мастер</label>
        <select value={masterId} onChange={e => {
          setMasterId(e.target.value);
          setHelpChoosing(false);
        }} disabled={helpChoosing} style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--hairline)' }}>
          <option value="">Любой свободный мастер</option>
          {availableMasters.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
          <input type="checkbox" checked={helpChoosing} onChange={e => {
            setHelpChoosing(e.target.checked);
            if (e.target.checked) setMasterId('');
          }} />
          Помогите выбрать мастера
        </label>
      </div>

      <div style={{ display: 'flex', gap: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
          <label>Желаемый день</label>
          <input type="text" placeholder="Например: завтра, в выходные" value={day} onChange={e => setDay(e.target.value)} style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--hairline)' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
          <label>Время</label>
          <input type="text" placeholder="Утро, после 18:00..." value={period} onChange={e => setPeriod(e.target.value)} style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--hairline)' }} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label>Комментарий</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--hairline)', resize: 'vertical' }}></textarea>
      </div>

      <button type="submit" disabled={loading} style={{ 
        background: 'var(--accent)', 
        color: '#fff', 
        border: 'none', 
        padding: '1rem', 
        borderRadius: '6px', 
        fontSize: '1.1rem', 
        fontWeight: 'bold', 
        cursor: loading ? 'not-allowed' : 'pointer',
        marginTop: '1rem'
      }}>
        {loading ? 'Отправка...' : 'Оставить заявку'}
      </button>
    </form>
  );
}
