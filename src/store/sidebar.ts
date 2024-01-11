import { proxy } from 'valtio';

export const sidebarStore = proxy({ visible: false });

export const sidebarActions = {
  setVisible: (visible: boolean) => {
    sidebarStore.visible = visible;
  },
};
