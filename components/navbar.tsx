import navbarStyles from "./navbar.module.css";
import utilStyles from "../styles//utils.module.css";

export default function Navbar({
  title,
  isShowTitle,
  leadingItem,
}: {
  title: string;
  isShowTitle?: boolean;
  leadingItem?: {
    icon: React.ReactNode;
    onClick: () => void;
  };
}) {
  return (
    <nav className={`${navbarStyles.navigationBar} ${utilStyles.onlyMobile}`}>
      <div className={navbarStyles.left}>
        {leadingItem && (
          <button className={utilStyles.button} onClick={leadingItem.onClick}>
            {leadingItem.icon}
          </button>
        )}
      </div>
      <div
        className={`${navbarStyles.title} ${
          isShowTitle ? navbarStyles.show : ""
        }`}
      >
        {title}
      </div>
      <div className={navbarStyles.right}></div>
    </nav>
  );
}

export const menuIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    className={navbarStyles.menuIcon}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 6h16M4 12h16M4 18h16"
    ></path>
  </svg>
);

export const backIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    className={navbarStyles.menuIcon}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M10 19l-7-7m0 0l7-7m-7 7h18"
    ></path>
  </svg>
);
