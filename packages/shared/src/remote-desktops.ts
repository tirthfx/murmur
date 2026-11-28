/**
 * Remote desktop clients (DC-34): the local clipboard does not reach the other side reliably, so
 * text is typed into them. The person can have any of these pasted into instead.
 */
export const REMOTE_DESKTOP_APPS: readonly { id: string; name: string }[] = [
  { id: "com.microsoft.rdc.macos", name: "Windows App (Microsoft Remote Desktop)" },
  { id: "com.microsoft.rdc.mac", name: "Microsoft Remote Desktop 8" },
  { id: "com.vmware.horizon", name: "VMware Horizon Client" },
  { id: "com.omnissa.horizon.client.mac", name: "Omnissa Horizon Client" },
  { id: "com.citrix.receiver.icaviewer.mac", name: "Citrix Viewer" },
  { id: "com.parallels.desktop.console", name: "Parallels Desktop" },
  { id: "com.teamviewer.TeamViewer", name: "TeamViewer" },
  { id: "com.philandro.anydesk", name: "AnyDesk" },
  { id: "com.apple.ScreenSharing", name: "Screen Sharing" },
];
