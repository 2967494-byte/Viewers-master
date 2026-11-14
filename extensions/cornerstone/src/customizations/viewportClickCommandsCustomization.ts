export default {
  cornerstoneViewportClickCommands: {
    // Window expansion is explicit via its button. Keep native double-click
    // tool gestures (e.g. finishing a measurement) independent of the layout.
    button1: ['closeContextMenu'],
    button3: [
      {
        commandName: 'showCornerstoneContextMenu',
        commandOptions: {
          requireNearbyToolData: true,
          menuId: 'measurementsContextMenu',
        },
      },
    ],
  },
};
