import Image from 'next/image';

const LOGO = '/assets/nicole-logo-dark.png';
const LOGO_PINK = '/assets/nicole-logo-pink.png';

/* Brand lockup: logo medallion + wordmark. The dark-disc logo shows in light
   mode; the magenta-disc logo shows in noir mode (swapped via CSS by theme). */
export default function BrandMark() {
  return (
    <a className="brand" href="#top">
      <span className="mark">
        <Image className="logo-light" src={LOGO} alt="Nicole Beauty" width={82} height={82} priority />
        <Image className="logo-pink" src={LOGO_PINK} alt="Nicole Beauty" width={82} height={82} />
      </span>
      <span className="wm">
        <span className="nm">Nicole Beauty</span>
        <span className="sub">салон красоты · Самара</span>
      </span>
    </a>
  );
}
