type SidePanelControl = {
  setPanelBehavior: (options: { openPanelOnActionClick: boolean }) => Promise<void>;
};

export async function configurePanel(sidePanel: SidePanelControl): Promise<void> {
  await sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}
