import { CrosshairsTool } from '@cornerstonejs/tools';

class PlusCrosshairsTool extends CrosshairsTool {
  constructor(toolProps = {}, defaultToolProps = {}) {
    super(toolProps, defaultToolProps);
  }

  // @ts-ignore
  renderAnnotation(enabledElement, svgDrawingHelper) {
    // Call parent to draw the reference lines
    // We use @ts-ignore because the type definition might incorrectly define this as a property
    let renderStatus = false;
    try {
        renderStatus = super.renderAnnotation(enabledElement, svgDrawingHelper);
    } catch (e) {
        console.warn('PlusCrosshairsTool: Error calling super.renderAnnotation', e);
    }

    // Now draw our custom Plus (+)
    this._drawPlus(enabledElement, svgDrawingHelper);

    return renderStatus;
  }

  _drawPlus(enabledElement, svgDrawingHelper) {
    const { viewport } = enabledElement;

    // Attempt to get toolCenter (check for specific property existence)
    // Note: TypeScript might complain, but this is JS runtime logic.
    // Use heuristic: Check this.toolCenter (common in CS3D tools)

    let center = (this as any).toolCenter;

    if (!center) {
       // Fallback: If we can't find toolCenter, assume Center of Viewport if autoPan is likely on,
       // or just don't draw to avoid misleading marker.
       const { element } = viewport;
       center = viewport.canvasToWorld([element.clientWidth / 2, element.clientHeight / 2]);
    }

    const canvasPos = viewport.worldToCanvas(center);
    const { x, y } = { x: canvasPos[0], y: canvasPos[1] };

    const toolUID = 'plus-crosshairs-marker';
    const color = 'rgb(0, 255, 255)'; // Cyan
    const lineWidth = 2;
    const size = 20; // 20px

    const svgns = 'http://www.w3.org/2000/svg';
    const svgNodeHash = toolUID;
    const existingElement = svgDrawingHelper.getSvgNode(svgNodeHash);

    // Build path
    // M x, y-size/2 L x, y+size/2
    // M x-size/2, y L x+size/2, y

    const path = `M ${x} ${y - size/2} L ${x} ${y + size/2} M ${x - size/2} ${y} L ${x + size/2} ${y}`;

    const attributes = {
      d: path,
      stroke: color,
      'stroke-width': lineWidth,
      fill: 'none',
      id: svgNodeHash,
    };

    if (existingElement) {
       Object.keys(attributes).forEach(key => {
         existingElement.setAttribute(key, attributes[key]);
       });
       svgDrawingHelper.setNodeTouched(svgNodeHash);
    } else {
       const newElement = document.createElementNS(svgns, 'path');
       Object.keys(attributes).forEach(key => {
         newElement.setAttribute(key, attributes[key]);
       });
       svgDrawingHelper.appendNode(newElement, svgNodeHash);
    }
  }
}

PlusCrosshairsTool.toolName = 'PlusCrosshairs';
export default PlusCrosshairsTool;
