'use client';

import { useState } from 'react';
import {
  Spark, IcWhats, IcTelegram, IcPhone, IcClock, IcScissors, IcHeart, IcCheck,
} from './icons';

type Service = {
  id: number;
  name: string;
};

type Master = {
  id: number;
  name: string;
  specialty?: string | null;
};

type MasterService = {
  master_id: number;
  service_id: number;
  price: number | string | null;
};

type ContactMethod = 'whatsapp' | 'telegram' | 'phone';

type YandexMetrica = (counterId: number, method: 'reachGoal', target: string) => void;

declare global {
  interface Window {
    ym?: YandexMetrica;
  }
}

const METHODS: { k: ContactMethod; label: string; Ic: typeof IcWhats }[] = [
  { k: 'whatsapp', label: 'WhatsApp', Ic: IcWhats },
  { k: 'telegram', label: 'Telegram', Ic: IcTelegram },
  { k: 'phone', label: 'Звонок', Ic: IcPhone },
];

// Реальные контакты салона — совпадают с футером (SiteFooter).
// Используются как запасной вариант, если env-переменные не заданы.
const SALON = {
  phone: '+7 987 244 5580',
  whatsapp: '+7 987 244 5580',
  telegram: 'nicole_salon',
};

export default function BookingWidget({
  services,
  masters,
  masterServices,
  whatsappNumber,
  telegramContact,
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
  const [notificationConsent, setNotificationConsent] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState<{ name?: boolean; contact?: boolean; service?: boolean }>({});
  const [success, setSuccess] = useState(false);

  // Derive available masters for the selected service.
  const availableMasters = serviceId
    ? masters.filter((m) => masterServices.some((ms) => ms.master_id === m.id && ms.service_id === Number(serviceId) && Number(ms.price) > 0))
    : masters;

  const reachGoal = (target: string) => {
    if (typeof window !== 'undefined' && window.ym) {
      const ymId = process.env.NEXT_PUBLIC_YANDEX_METRICA_ID;
      if (ymId) window.ym(Number(ymId), 'reachGoal', target);
    }
  };

  const reset = () => {
    setServiceId(''); setMasterId(''); setHelpChoosing(false); setContactMethod('whatsapp');
    setName(''); setContact(''); setDay(''); setPeriod(''); setNote(''); setNotificationConsent(false);
    setError(''); setTouched({}); setSuccess(false);
  };

  // Открыть нужное приложение сразу по клику (реальные контакты, env как приоритет).
  const openChannel = (method: ContactMethod) => {
    const waNumber = (whatsappNumber || SALON.whatsapp).replace(/\D/g, '');
    const tgContact = (telegramContact || SALON.telegram).replace('@', '');
    const phoneNumber = SALON.phone.replace(/\D/g, '');

    if (method === 'whatsapp') {
      window.open(`https://wa.me/${waNumber}`, '_blank', 'noopener,noreferrer');
    } else if (method === 'telegram') {
      window.open(`https://t.me/${tgContact}`, '_blank', 'noopener,noreferrer');
    } else if (method === 'phone') {
      window.location.href = `tel:+${phoneNumber}`;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    reachGoal('cta_click');
    setTouched({ name: true, contact: true, service: true });

    if (!name.trim() || !contact.trim()) {
      setError('Пожалуйста, укажите имя и контакт.');
      return;
    }
    if (!serviceId) {
      setError('Пожалуйста, выберите услугу.');
      return;
    }

    setLoading(true);
    try {
      const selectedService = services.find((s) => s.id === Number(serviceId));
      const selectedMaster = masters.find((m) => m.id === Number(masterId));

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
        notification_consent: notificationConsent,
        note,
      };

      const res = await fetch('/api/booking-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Ошибка при отправке заявки');
      }

      setSuccess(true);
      reachGoal('request_sent');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Произошла ошибка');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="section" id="booking">
      <div className="wrap booking-grid">
        <div className="booking-aside reveal">
          <span className="eyebrow"><Spark /> запись онлайн</span>
          <h2>Запишитесь <em>за минуту</em></h2>
          <p>Оставьте заявку — мы свяжемся с вами удобным способом, подтвердим время и подберём свободного мастера.</p>
          <div className="points">
            <div className="pt"><span className="ic"><IcClock /></span><span><b>Ответим быстро</b><span>Подтверждаем запись в течение рабочего дня</span></span></div>
            <div className="pt"><span className="ic"><IcScissors /></span><span><b>Поможем выбрать</b><span>Подскажем мастера и услугу под ваш запрос</span></span></div>
            <div className="pt"><span className="ic"><IcHeart /></span><span><b>Без предоплаты</b><span>Бронирование ни к чему вас не обязывает</span></span></div>
          </div>
        </div>

        <div className="booking-card reveal" data-d="1">
          {success ? (
            <div className="booking-success">
              <span className="seal"><IcCheck /></span>
              <h3>Заявка отправлена</h3>
              <p>Спасибо, {name || 'что выбрали нас'}! Мы свяжемся с вами в ближайшее время для подтверждения записи.</p>
              {notificationConsent && (
                <a
                  className="btn btn-primary"
                  href="https://t.me/nicole_salon_alerts_bot?start=reminders"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IcTelegram /> Подключить напоминания в Telegram
                </a>
              )}
              <button type="button" className="btn btn-ghost again" onClick={reset}>Оставить ещё одну</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              {error && <div className="form-error"><Spark s={13} />{error}</div>}

              <div className="field row2">
                <div>
                  <label>Имя <span className="req">*</span></label>
                  <input
                    className={'input' + (touched.name && !name.trim() ? ' err' : '')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Как к вам обращаться"
                  />
                </div>
                <div>
                  <label>Телефон или ник <span className="req">*</span></label>
                  <input
                    className={'input' + (touched.contact && !contact.trim() ? ' err' : '')}
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="+7… или @никнейм"
                  />
                </div>
              </div>

              <div className="field">
                <span className="flabel">Удобный способ связи</span>
                <div className="seg">
                  {METHODS.map(({ k, label, Ic }) => (
                    <button type="button" key={k} className={contactMethod === k ? 'on' : ''} onClick={() => { setContactMethod(k); openChannel(k); }}>
                      <Ic />{label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field row2">
                <div>
                  <label>Услуга <span className="req">*</span></label>
                  <select
                    className={'select' + (touched.service && !serviceId ? ' err' : '')}
                    value={serviceId}
                    onChange={(e) => { setServiceId(e.target.value); setMasterId(''); }}
                  >
                    <option value="">Выберите услугу…</option>
                    {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label>Мастер</label>
                  <select
                    className="select"
                    value={masterId}
                    disabled={helpChoosing}
                    onChange={(e) => { setMasterId(e.target.value); setHelpChoosing(false); }}
                  >
                    <option value="">Любой свободный мастер</option>
                    {availableMasters.map((m) => (
                      <option key={m.id} value={m.id}>{m.specialty ? `${m.name} · ${m.specialty}` : m.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="check">
                <input
                  type="checkbox"
                  checked={helpChoosing}
                  onChange={(e) => { setHelpChoosing(e.target.checked); if (e.target.checked) setMasterId(''); }}
                />
                <span className="box"><IcCheck /></span>
                <span>Помогите выбрать мастера</span>
              </label>

              <div className="field row2" style={{ marginTop: '20px' }}>
                <div>
                  <label>Желаемый день</label>
                  <input className="input" value={day} onChange={(e) => setDay(e.target.value)} placeholder="Завтра, в выходные…" />
                </div>
                <div>
                  <label>Время</label>
                  <input className="input" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="Утро, после 18:00…" />
                </div>
              </div>

              <div className="field">
                <label>Комментарий</label>
                <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ваши пожелания к визиту" />
              </div>

              <label className="check">
                <input
                  type="checkbox"
                  checked={notificationConsent}
                  onChange={(e) => setNotificationConsent(e.target.checked)}
                />
                <span className="box"><IcCheck /></span>
                <span>Я согласен(на) получать сервисные напоминания о записи в Telegram или по SMS.</span>
              </label>

              <div className="submit-row">
                <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
                  {loading ? 'Отправка…' : 'Оставить заявку'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
