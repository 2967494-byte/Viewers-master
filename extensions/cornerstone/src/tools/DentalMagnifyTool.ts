import { BaseTool } from '@cornerstonejs/tools';

/** The screen loupe is read-only: a primary click must not move crosshairs or annotations. */
export default class DentalMagnifyTool extends BaseTool {
  static toolName = 'DentalMagnify';

  constructor(toolProps = {}) {
    super(toolProps, { supportedInteractionTypes: ['Mouse'], configuration: {} });
  }

  preMouseDownCallback = event => {
    event.preventDefault();
    return true;
  };
}
