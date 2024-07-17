//@ts-nocheck
import classNames from 'classnames';
import Link from 'next/link';
import { useRouter } from 'next/router';
import React, { useMemo } from 'react';
import utilStyles from '~styles/utils.module.css';

export default function ActiveLink({
  children,
  href,
  shouldShowNewTab = false,
}: {
  children: React.ReactNode;
  href: string;
  shouldShowNewTab?: boolean;
}) {
  const { asPath, pathname } = useRouter();

  const isActive = useMemo(() => {
    if (asPath === href) {
      return true;
    }
    if (pathname === '/blogs/[id]' && href === '/blogs') {
      return true;
    }
    if (pathname === '/issues/[id]' && href === '/issues') {
      return true;
    }
    if (pathname === '/javascript/[id]' && href === '/javascript') {
      return true;
    }
    return false;
  }, [asPath, href, pathname]);

  return (
    <Link
      className={classNames(utilStyles.link, {
        [utilStyles.activeLink]: isActive,
      })}
      href={href}
      target={shouldShowNewTab ? '_blank' : '_self'}
      aria-current={isActive ? 'page' : null}
    >
      <> {children}</>
    </Link>
  );
}
