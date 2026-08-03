import Link from 'next/link';
import { useRouter } from 'next/router';

const TABS = [
  { href: '/', label: 'Sinyal', icon: '🏠' },
  { href: '/rekapan', label: 'Rekapan', icon: '📋' },
];

export default function BottomNav() {
  const router = useRouter();
  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => {
        const active = router.pathname === tab.href;
        return (
          <Link key={tab.href} href={tab.href} className={`nav-item ${active ? 'active' : ''}`}>
            <span className="nav-icon">{tab.icon}</span>
            <span className="nav-label">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
