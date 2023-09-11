import { AppProps } from "next/app";
import "../styles/globals.css";
import SidebarContext from "../context/SidebarContext";
import { useState } from "react";

function App({ Component, pageProps }: AppProps) {
  const [isShowSidebar, setIsShowSidebar] = useState(false);

  return (
    <SidebarContext.Provider
      value={{ isShow: isShowSidebar, setIsShow: setIsShowSidebar }}
    >
      <Component {...pageProps} />
    </SidebarContext.Provider>
  );
}

export default App;
