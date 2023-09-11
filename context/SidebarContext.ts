import { createContext } from "react";

const SidebarContext = createContext({
  isShow: false,
  setIsShow: (isShow: boolean) => {},
});

export default SidebarContext;
