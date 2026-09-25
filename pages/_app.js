import { useEffect } from 'react';
import Head from 'next/head';
import { Comic_Neue } from 'next/font/google';
import BottomNav from '../components/BottomNav';
import UpdateFab from '../components/UpdateFab';
import {
  applyTheme, getStoredTheme, applyTextScale, getStoredTextScale, applyBold, getStoredBold,
} from '../lib/theme';
import '../styles/globals.css';

// Comic Neue - a rounded, casual font swapped in for the previous serious
// grotesk (Inter), on purpose: reading signals/P&L all day felt too
// "serious", so the whole app leans friendlier now instead of terminal-like.
// Comic Neue only ships fixed weights (not a variable font), so both used
// weights are requested explicitly.
const comicNeue = Comic_Neue({
  subsets: ['latin'], weight: ['400', '700'], display: 'swap', variable: '--font-app',
});

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
      <div className={`app-shell ${comicNeue.variable}`}>
        <main className="app-main">
          <Component {...pageProps} />
        </main>
        <UpdateFab />
        <BottomNav />
      </div>
    </>
  );
}
