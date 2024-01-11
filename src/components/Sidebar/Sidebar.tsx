import { useSnapshot } from 'valtio';
import sidebarStyles from './sidebar.module.css';
import utilStyles from '~styles/utils.module.css';
import { sidebarActions, sidebarStore } from '~store/sidebar';
import Logo from '~components/IconJsx/Logo';

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const { visible } = useSnapshot(sidebarStore);

  return (
    <nav className={`${sidebarStyles.sidebar} ${visible ? sidebarStyles.show : ''}`}>
      <header className={sidebarStyles.header}>
        <Logo />
        <button
          className={`${utilStyles.button} ${utilStyles.onlyMobile}`}
          onClick={() => {
            sidebarActions.setVisible(false);
          }}
        >
          <svg
            xmlns='http://www.w3.org/2000/svg'
            fill='none'
            viewBox='0 0 24 24'
            stroke='currentColor'
            strokeWidth='2'
            className={sidebarStyles.xIcon}
          >
            <path strokeLinecap='round' strokeLinejoin='round' d='M6 18L18 6M6 6l12 12'></path>
          </svg>
        </button>
      </header>
      {children}
    </nav>
  );
}

export const SidebarSection = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => {
  return (
    <section className={sidebarStyles.section}>
      {title.length !== 0 && <h4 className={sidebarStyles.sectionTitle}>{title}</h4>}
      {children}
    </section>
  );
};
