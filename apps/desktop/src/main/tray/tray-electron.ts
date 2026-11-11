import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from "electron";
import type { TrayHost, TrayView } from "./tray-controller";
import { micPng } from "./tray-icon";
import type { TrayAction, TrayItem, TrayStatus } from "./tray-menu";

// macOS shows this text next to the icon and understands ANSI colours in it.
const DOT: Record<TrayStatus, string> = {
  idle: "",
  listening: "\u001b[31m●",
  warning: "\u001b[33m●",
};

function template(
  items: TrayItem[],
  perform: (action: TrayAction) => void,
): MenuItemConstructorOptions[] {
  return items.map((item): MenuItemConstructorOptions => {
    if (item.kind === "separator") return { type: "separator" };
    const action = item.action;
    return {
      label: item.label,
      enabled: item.enabled ?? true,
      ...(item.checked === undefined ? {} : { type: "radio" as const, checked: item.checked }),
      ...(item.submenu ? { submenu: template(item.submenu, perform) } : {}),
      ...(action ? { click: () => perform(action) } : {}),
    };
  });
}

function micImage(): Electron.NativeImage {
  const image = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2]) {
    image.addRepresentation({
      scaleFactor,
      dataURL: `data:image/png;base64,${micPng(scaleFactor).toString("base64")}`,
    });
  }
  image.setTemplateImage(true);
  return image;
}

export interface ElectronTray extends TrayHost {
  /** Called when the pointer reaches the icon, just before the menu can open. */
  onHover(handler: () => void): void;
  destroy(): void;
}

/** The menu bar item. Create it after the app is ready. */
export function createElectronTray(perform: (action: TrayAction) => void): ElectronTray {
  const tray = new Tray(micImage());
  return {
    render(view: TrayView) {
      tray.setContextMenu(Menu.buildFromTemplate(template(view.items, perform)));
      tray.setToolTip(view.tooltip);
      if (process.platform === "darwin") tray.setTitle(DOT[view.status]);
    },
    onHover(handler) {
      tray.on("mouse-enter", handler);
    },
    destroy() {
      tray.destroy();
    },
  };
}
