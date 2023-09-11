import Link from "next/link";
import { useRouter } from "next/router";
import React from "react";
import utilStyles from "../styles/utils.module.css";

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

  // TODO: Refactor this for dynamic routes
  function isActive(asPath: string, pathname: string, href: string): boolean {
    if (asPath === href) {
      return true;
    }
    if (pathname === "/blog/[id]" && href === "/blog") {
      return true;
    }
    return false;
  }
  return (
    <Link
      className={utilStyles.activeLink}
      href={href}
      target={shouldShowNewTab ? "_blank" : null}
      aria-current={isActive(asPath, pathname, href) ? "page" : null}
    >
      {children}
    </Link>
  );
}
