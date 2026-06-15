export type MenuAction = () => Promise<void> | void;

export interface MenuItem {
  label: string;
  action?: MenuAction;
  submenu?: MenuNode;
}

export interface MenuNode {
  title: string;
  items: MenuItem[];
}

export interface MenuKey {
  ctrl?: boolean;
  name?: string;
  sequence?: string;
}

export class MenuActionReportedError extends Error {}
export class MenuInterruptedError extends Error {}
