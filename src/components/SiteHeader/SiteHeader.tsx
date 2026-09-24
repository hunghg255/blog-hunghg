import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useSignal } from 'reactjs-signal';
import classNames from 'classnames';
import Logo from '~components/IconJsx/Logo';
import { Icon } from '~components/Icon/Icon';
import { sidebarActions, sidebarStore } from '~store/sidebar';
import { Ticon } from '~styles/icon/icon-type';
import styles from './siteHeader.module.css';

export const NAV_ITEMS: { href: string; label: string; icon: Ticon }[] = [
  { href: '/', label: 'Home', icon: 'icon-phhouse' },
  { href: '/blogs', label: 'Blogs', icon: 'icon-carbonblog' },
  { href: '/issues', label: 'Issues', icon: 'icon-streamlinecollaborationsidea' },
  { href: '/javascript', label: 'Javascript', icon: 'icon-mdicodejson' },
  { href: '/tools', label: 'Tools', icon: 'icon-fluentwindowdevtools24regular' },
];

export const isNavActive = (pathname: string, href: string) =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

export default function SiteHeader() {
  const { pathname, asPath } = useRouter();
  const [open] = useSignal(sidebarStore);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the mobile menu on navigation
  useEffect(() => {
    sidebarActions.setVisible(false);
  }, [asPath]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && sidebarActions.setVisible(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <header className={classNames(styles.header, { [styles.scrolled]: scrolled || open })}>
        <div className={styles.inner}>
          <Link href='/' className={styles.brand} aria-label='Home'>
            <Logo />
            <span>
              hunghg<span className={styles.brandDot}>.</span>blog
            </span>
          </Link>

          <nav className={styles.nav} aria-label='Main'>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={classNames(styles.navLink, {
                  [styles.active]: isNavActive(pathname, item.href),
                })}
                aria-current={isNavActive(pathname, item.href) ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className={styles.actions}>
            <a
              href='https://github.com/hunghg255'
              target='_blank'
              rel='noopener noreferrer'
              className={styles.iconButton}
              aria-label='GitHub'
            >
              <Icon icon='icon-mynauibrandgithub' />
            </a>
            <button
              type='button'
              className={classNames(styles.iconButton, styles.menuButton)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              onClick={() => sidebarActions.setVisible(!open)}
            >
              <span className={classNames(styles.burger, { [styles.burgerOpen]: open })}>
                <span />
                <span />
              </span>
            </button>
          </div>
        </div>
      </header>

      <div
        className={classNames(styles.mobileMenu, { [styles.mobileMenuOpen]: open })}
        aria-hidden={!open}
      >
        <nav className={styles.mobileNav} aria-label='Mobile'>
          {NAV_ITEMS.map((item, i) => (
            <Link
              key={item.href}
              href={item.href}
              tabIndex={open ? 0 : -1}
              style={{ transitionDelay: open ? `${60 + i * 35}ms` : '0ms' }}
              className={classNames(styles.mobileLink, {
                [styles.active]: isNavActive(pathname, item.href),
              })}
            >
              <Icon icon={item.icon} />
              {item.label}
            </Link>
          ))}
          <a
            href='https://github.com/hunghg255'
            target='_blank'
            rel='noopener noreferrer'
            tabIndex={open ? 0 : -1}
            style={{ transitionDelay: open ? `${60 + NAV_ITEMS.length * 35}ms` : '0ms' }}
            className={styles.mobileLink}
          >
            <Icon icon='icon-mynauibrandgithub' />
            Github
          </a>
        </nav>
      </div>
    </>
  );
}
