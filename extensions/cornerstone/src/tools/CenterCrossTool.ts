import { AnnotationDisplayTool } from '@cornerstonejs/tools';

class CenterCrossTool extends AnnotationDisplayTool {
  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        shadow: true,
        preventHandleOutsideImage: false,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
    console.log('CenterCrossTool: Initialized');
  }

  renderAnnotation(enabledElement, svgDrawingHelper) {
    const { viewport } = enabledElement;
    if (!viewport) {
      return;
    }
    // console.log('CenterCrossTool renderAnnotation running for viewport', viewport.id);

    // Get viewport center in canvas coordinates (using client dimensions for SVG consistency)
    const { element } = viewport;
    const centerCanvas = [element.clientWidth / 2, element.clientHeight / 2];

    const crosshairLength = 20; // Length of the crosshair lines
    const color = 'rgb(0, 255, 255)'; // Cyan color
    const lineWidth = 2;

    const verticalLine = {
      start: [centerCanvas[0], centerCanvas[1] - crosshairLength / 2],
      end: [centerCanvas[0], centerCanvas[1] + crosshairLength / 2],
    };

    const horizontalLine = {
      start: [centerCanvas[0] - crosshairLength / 2, centerCanvas[1]],
      end: [centerCanvas[0] + crosshairLength / 2, centerCanvas[1]],
    };

    const annotationUID = 'centerCross';

    // Helper function to draw a line
    const drawLine = (line, lineUID) => {
        const svgns = 'http://www.w3.org/2000/svg';
        const svgNodeHash = lineUID;
        const existingElement = svgDrawingHelper.getSvgNode(svgNodeHash);
        const attributes = {
          x1: line.start[0],
          y1: line.start[1],
          x2: line.end[0],
          y2: line.end[1],
          stroke: color,
          'stroke-width': lineWidth,
          id: lineUID,
        };

        if (existingElement) {
          // drawing.setAttributesIfNecessary(attributes, existingElement);
           // Fallback if setAttributesIfNecessary is not available or behaves oddly
           Object.keys(attributes).forEach(key => {
             existingElement.setAttribute(key, attributes[key]);
           });
          svgDrawingHelper.setNodeTouched(svgNodeHash);
        } else {
          const newElement = document.createElementNS(svgns, 'line');
           Object.keys(attributes).forEach(key => {
             newElement.setAttribute(key, attributes[key]);
           });
          svgDrawingHelper.appendNode(newElement, svgNodeHash);
        }
    };

    drawLine(verticalLine, 'vLine');
    drawLine(horizontalLine, 'hLine');

    return true;
  }
}

CenterCrossTool.toolName = 'CenterCross';
export default CenterCrossTool;
