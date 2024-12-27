import { createSignal } from 'reactjs-signal';

export const sidebarStore = createSignal(false);

export const sidebarActions = {
  setVisible: (visible: boolean) => {
    sidebarStore.set(visible);
  },
};
