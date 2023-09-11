import Head from "next/head";
import Layout, { siteTitle } from "../components/layout";
import utilStyles from "../styles/utils.module.css";
import Navbar, { menuIcon } from "../components/navbar";
import { useContext } from "react";
import SidebarContext from "../context/SidebarContext";

export default function Home() {
  const { setIsShow } = useContext(SidebarContext);

  return (
    <Layout home>
      <Head>
        <title>{siteTitle}</title>
      </Head>
      <div className={utilStyles.container}>
        <Navbar
          title="Home"
          isShowTitle
          leadingItem={{
            icon: menuIcon,
            onClick: () => {
              setIsShow(true);
            },
          }}
        />
        <div className={`${utilStyles.mono} ${utilStyles.description}`}>
          👋 Hello there
        </div>
      </div>
    </Layout>
  );
}
