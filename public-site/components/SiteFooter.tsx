import BrandMark from './BrandMark';
import { IcPin, IcClock, IcPhone, IcWhats, IcInstagram, IcTelegram, IcGlobe } from './icons';

const SOCIAL = {
  instagram: 'nicole_beauty_salon',
  whatsapp: '+7 987 244 5580',
  telegram: 'nicole_salon',
  site: 'nicolesalon.ru',
};

export default function SiteFooter() {
  return (
    <footer className="site-footer" id="contacts">
      <div className="wrap">
        <div className="footer-top">
          <div className="footer-brand">
            <BrandMark />
            <p>Салон красоты с вниманием к каждой детали. Следите за новостями, акциями и работами наших мастеров.</p>
          </div>
          <div className="footer-col">
            <h5>Контакты</h5>
            <p><IcPin /> ул. Чернореченская, 49, Самара</p>
            <p><IcClock /> Ежедневно с 9:00 до 20:00</p>
            <p><IcPhone /> +7 987 244 5580</p>
          </div>
          <div className="footer-col">
            <h5>Мы в сетях</h5>
            <a href={`https://instagram.com/${SOCIAL.instagram}`} target="_blank" rel="noopener noreferrer"><IcInstagram /> @{SOCIAL.instagram}</a>
            <a href={`https://wa.me/${SOCIAL.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"><IcWhats /> {SOCIAL.whatsapp}</a>
            <a href={`https://t.me/${SOCIAL.telegram}`} target="_blank" rel="noopener noreferrer"><IcTelegram /> @{SOCIAL.telegram}</a>
            <a href={`https://${SOCIAL.site}`} target="_blank" rel="noopener noreferrer"><IcGlobe /> {SOCIAL.site}</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Nicole Salon. Все права защищены.</span>
          <span>Сделано с любовью к красоте</span>
        </div>
      </div>
    </footer>
  );
}
