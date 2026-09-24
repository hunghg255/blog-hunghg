import Link from 'next/link';
import { NAV_ITEMS } from '~components/SiteHeader/SiteHeader';
import { SOCIAL_LINKS } from 'src/constants/constant';
import styles from './footer.module.css';

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.about}>
          <p className={styles.brand}>
            hunghg<span>.</span>blog
          </p>
          <p className={styles.tagline}>Ghi chép về Web development, JavaScript & System design.</p>
        </div>
        <nav className={styles.links} aria-label='Footer'>
          {NAV_ITEMS.filter((i) => i.href !== '/').map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
          {SOCIAL_LINKS.slice(0, 3).map((item) => (
            <a key={item.href} href={item.href} target='_blank' rel='noopener noreferrer'>
              {item.label}
            </a>
          ))}
        </nav>
      </div>
      <div className={styles.bottom}>© {new Date().getFullYear()} Hung Hoang · Made in Hanoi</div>
    </footer>
  );
}
