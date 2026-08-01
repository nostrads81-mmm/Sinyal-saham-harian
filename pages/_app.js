import Head from 'next/head';
import BottomNav from '../components/BottomNav';
import '../styles/globals.css';

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>Sinyal Saham Harian</title>
      </Head>
      <div className="app-shell">
        <main className="app-main">
          <Component {...pageProps} />
        </main>
        <BottomNav />
      </div>
    </>
  );
}
