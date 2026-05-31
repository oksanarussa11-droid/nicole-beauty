import BrandMark from './BrandMark';
import { IcPin, IcClock, IcInstagram, IcTelegram, IcGlobe } from './icons';

const SOCIAL = {
  instagram: 'nicole_beauty_salon',
  telegram: 'nicole_salon',
  site: 'nicole-salon-pro.vercel.app',
};

export default function SiteFooter() {
  return (
    <footer className="site-footer" id="contacts">
      <div className="wrap">
        <div className="footer-top">
          <div className="footer-brand">
            <BrandMark />
            <p>Студия красоты с вниманием к каждой детали. Следите за новостями, акциями и работами наших мастеров.</p>
          </div>
          <div className="footer-col">
            <h5>Контакты</h5>
            <p><IcPin /> г. Самара</p>
            <p><IcClock /> Ежедневно · 9:00 – 21:00</p>
          </div>
          <div className="footer-col">
            <h5>Мы в сетях</h5>
            <a href={`https://instagram.com/${SOCIAL.instagram}`} target="_blank" rel="noopener noreferrer"><IcInstagram /> @{SOCIAL.instagram}</a>
            <a href={`https://t.me/${SOCIAL.telegram}`} target="_blank" rel="noopener noreferrer"><IcTelegram /> @{SOCIAL.telegram}</a>
            <a href={`https://${SOCIAL.site}`} target="_blank" rel="noopener noreferrer"><IcGlobe /> {SOCIAL.site}</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Nicole Beauty. Все права защищены.</span>
          <span>Сделано с любовью к красоте</span>
        </div>
      </div>
    </footer>
  );
}
