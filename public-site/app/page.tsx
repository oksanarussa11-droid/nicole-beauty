import { getPublicMasters, getServices, getMasterServices, getSalonGallery, servicePrices } from '@/lib/data';
import SiteHeader from '@/components/SiteHeader';
import Hero from '@/components/Hero';
import MastersCarousel from '@/components/MastersCarousel';
import SalonGallery from '@/components/SalonGallery';
import Services from '@/components/Services';
import BookingWidget from '@/components/BookingWidget';
import SiteFooter from '@/components/SiteFooter';
import RevealOnScroll from '@/components/RevealOnScroll';

export default async function Home() {
  const masters = await getPublicMasters();
  const services = await getServices();
  const masterServices = await getMasterServices();
  const gallery = await getSalonGallery();

  const prices = servicePrices(services, masterServices, masters.map((m) => m.id));

  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <MastersCarousel masters={masters} />
        <SalonGallery items={gallery} />
        <Services prices={prices} />
        <BookingWidget
          services={services}
          masters={masters}
          masterServices={masterServices}
          whatsappNumber={process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}
          telegramContact={process.env.NEXT_PUBLIC_TELEGRAM_CONTACT}
        />
      </main>
      <SiteFooter />
      <RevealOnScroll />
    </>
  );
}
