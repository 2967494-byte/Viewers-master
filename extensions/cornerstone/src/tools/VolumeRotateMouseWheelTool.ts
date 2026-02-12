import { BaseTool, Enums } from '@cornerstonejs/tools';
import { getEnabledElement } from '@cornerstonejs/core';
import { vec3, mat4 } from 'gl-matrix';

class VolumeRotateMouseWheelTool extends BaseTool {
  static toolName = 'VolumeRotateMouseWheel';

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        rotateIncrementDegrees: 2, // Degrees per scroll
      },
    }
  ) {
    super(toolProps, defaultToolProps);
    console.log("VolumeRotateMouseWheelTool: Constructor called - tool registered");
  }

  mouseWheelCallback(evt) {
    const { element, wheel, viewport } = evt.detail;
    const { direction } = wheel;
    const { configuration } = this;

    // Direction > 0 is "down/towards", Direction < 0 is "up/away"
    // Requirement:
    // "От себя" (away, dir < 0) -> Наклоняться вправо (Tilt Right, CW Image Rotation)
    // "На себя" (towards, dir > 0) -> Наклоняться влево (Tilt Left, CCW Image Rotation)

    // To rotate Image CW, we must rotate Camera ViewUp CCW.
    // To rotate Image CCW, we must rotate Camera ViewUp CW.

    const rotateIncrement = configuration.rotateIncrementDegrees;

    let angle = 0;
    if (direction < 0) {
       // Scroll Up (Away) -> Want Image CW -> Camera CCW
       // Standard rotation logic: Positive axis rotation is CCW.
       angle = rotateIncrement;
    } else {
       // Scroll Down (Towards) -> Want Image CCW -> Camera CW
       angle = -rotateIncrement;
    }

    const camera = viewport.getCamera();
    const { viewUp, position, focalPoint } = camera;

    console.log("VolumeRotateMouseWheel: Before tilt", { viewUp: [...viewUp], position: [...(position || [])], focalPoint: [...(focalPoint || [])] });

    // View Direction (VPN) used as rotation axis
    const viewDirection = vec3.create();
    vec3.subtract(viewDirection, focalPoint, position);
    vec3.normalize(viewDirection, viewDirection);

    const rotationRadians = (angle * Math.PI) / 180;

    // Create rotation matrix around viewDirection
    const rotationMat = mat4.create();
    mat4.fromRotation(rotationMat, rotationRadians, viewDirection);

    // Rotate viewUp vector ONLY - position and focalPoint stay the same
    const newViewUp = vec3.create();
    vec3.transformMat4(newViewUp, viewUp, rotationMat);

    console.log("VolumeRotateMouseWheel: After tilt", { newViewUp: [newViewUp[0], newViewUp[1], newViewUp[2]], angle });

    // CRITICAL: Only set viewUp, do NOT change position or focalPoint
    viewport.setCamera({
      viewUp: [newViewUp[0], newViewUp[1], newViewUp[2]],
    });

    viewport.render();
  }
}

export default VolumeRotateMouseWheelTool;
