import { useEffect } from 'react';
import Head from 'next/head';
import { Inter } from 'next/font/google';
import BottomNav from '../components/BottomNav';
import {
  applyTheme, getStoredTheme, applyTextScale, getStoredTextScale, applyBold, getStoredBold,
} from '../lib/theme';
import '../styles/globals.css';

// Inter - the geometric grotesk most trading/fintech apps default to (clean,
// high legibility for numbers, tabular figures available). Loaded as a
// self-hosted variable font via next/font so there's no external request at
// runtime, keeping the PWA fast/offline-friendly.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export default function App({ Component, pageProps }) {
  useEffect(() => {
    applyTheme(getStoredTheme());
    applyTextScale(getStoredTextScale());
    applyBold(getStoredBold());
  }, []);

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>Sinyal Saham Harian</title>
      </Head>
      <div className={`app-shell ${inter.variable}`}>
        <main className="app-main">
          <Component {...pageProps} />
        </main>
        <BottomNav />
      </div>
    </>
  );
}
