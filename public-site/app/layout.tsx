import type { Metadata } from 'next'
import Script from 'next/script'
import { Cormorant_Garamond, DM_Sans } from 'next/font/google'
import './globals.css'

// Self-hosted via next/font (no external Google requests, no layout shift).
// DM Sans has no Cyrillic subset, so Russian body text falls back to the
// system sans via the CSS stack — same as before this migration.
const cormorant = Cormorant_Garamond({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500', '600'],
  variable: '--font-serif',
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Nicole Beauty',
  description: 'Салон красоты в Самаре',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ymId = process.env.NEXT_PUBLIC_YANDEX_METRICA_ID;
  return (
    <html lang="ru" className={`${cormorant.variable} ${dmSans.variable}`}>
      <body>
        {children}
        {ymId && (
          <Script id="yandex-metrica" strategy="afterInteractive">
            {`
              (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
              m[i].l=1*new Date();
              for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
              k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
              (window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
        
              ym(${ymId}, "init", {
                   clickmap:true,
                   trackLinks:true,
                   accurateTrackBounce:true
              });
            `}
          </Script>
        )}
      </body>
    </html>
  )
}
