import type { Metadata } from 'next';
import { Geist, Geist_Mono, JetBrains_Mono, Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';
import { ThemeProvider } from '@/lib/themeContext';
import AppInit from '@/components/AppInit';

const geistSans = Geist({ variable: '--font-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-mono', subsets: ['latin'] });
const jetbrainsMono = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'], weight: ['400', '500', '700'] });
const inter = Inter({ variable: '--font-inter', subsets: ['latin'], weight: ['400', '500', '600', '700'] });
// Space Grotesk — headings, balances, KPI display numbers (brand §2)
const spaceGrotesk = Space_Grotesk({ variable: '--font-space', subsets: ['latin'], weight: ['500', '600', '700'] });

export const metadata: Metadata = {
  title: 'Westron',
  description: 'Native macOS portfolio tracker for Ethereum & NFTs',
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/icon-source.png',
  },
};

// Brand v2: dark theme is fixed. Pin the attribute before hydration.
const ANTI_FLASH = `(function(){
  try { document.documentElement.setAttribute('data-theme','night'); } catch(e){}
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="night" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} ${inter.variable} ${spaceGrotesk.variable} h-full`}>
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH }} />
      </head>
      <body className="h-full flex flex-col antialiased" style={{ backgroundColor: 'var(--wr-bg)', color: 'var(--wr-text)' }}>
        <ThemeProvider>
          <AppInit />
          <Navbar />
          <div className="flex-1 overflow-auto">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
