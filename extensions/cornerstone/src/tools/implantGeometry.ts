import { mat4, quat, vec3 } from 'gl-matrix';
import type { Point3 } from './dentalGeometry';

/** Anatomical superior axis is shared by every MPR pane; never use the camera normal as the implant axis. */
export function implantEndpoints(position: Point3, length: number): [Point3, Point3] {
  return [[...position], [position[0], position[1], position[2] + length]];
}

/** Unit cylinder (height 1, diameter 1, local Y axis) transformed once into patient millimetres. */
export function implantMatrix(start: Point3, end: Point3, diameter: number) {
  const direction = vec3.sub(vec3.create(), end, start);
  const length = vec3.length(direction);
  if (length <= 0 || diameter <= 0) return null;
  vec3.scale(direction, direction, 1 / length);
  const rotation = quat.rotationTo(quat.create(), [0, 1, 0], direction);
  const center = vec3.lerp(vec3.create(), start, end, 0.5);
  return mat4.fromRotationTranslationScale(mat4.create(), rotation, center, [
    diameter,
    length,
    diameter,
  ]);
}

const sub = (a: Point3, b: Point3): Point3 => a.map((v, i) => v - b[i]) as Point3;
const dot = (a: Point3, b: Point3) => a.reduce((s, v, i) => s + v * b[i], 0);
const unit = (p: Point3): Point3 => {
  const length = Math.hypot(...p);
  return p.map(v => v / (length || 1)) as Point3;
};
const cross = (a: Point3, b: Point3): Point3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Rotate around the displayed plane normal; keep the platform, length and out-of-plane tilt. */
export function rotateImplantInPlane(
  start: Point3,
  end: Point3,
  from: Point3,
  to: Point3,
  normal: Point3
): Point3 {
  const n = unit(normal),
    axis = sub(end, start);
  const project = (p: Point3) => {
    const v = sub(p, start),
      d = dot(v, n);
    return v.map((x, i) => x - d * n[i]) as Point3;
  };
  const a = project(from),
    b = project(to);
  if (Math.hypot(...a) < 1e-6 || Math.hypot(...b) < 1e-6) return [...end];
  const angle = Math.atan2(dot(n, cross(a, b)), dot(a, b)),
    c = Math.cos(angle),
    s = Math.sin(angle);
  const perpendicular = cross(n, axis),
    along = dot(n, axis);
  return start.map(
    (v, i) => v + axis[i] * c + perpendicular[i] * s + n[i] * along * (1 - c)
  ) as Point3;
}

/** Patient XZ/YZ controls are a display of the world axis, never a dependency on the CPR arch. */
export function implantAngles(start: Point3, end: Point3) {
  const axis = unit(sub(end, start)),
    direction = axis[2] < 0 ? -1 : 1;
  return {
    frontal: (Math.atan2(axis[0], Math.abs(axis[2])) * 180) / Math.PI,
    sagittal: (Math.asin(Math.max(-1, Math.min(1, axis[1]))) * 180) / Math.PI,
    direction,
  };
}

export function implantAxisFromAngles(
  frontal: number,
  sagittal: number,
  direction: number
): Point3 {
  const a = (frontal * Math.PI) / 180,
    b = (sagittal * Math.PI) / 180;
  return [
    Math.sin(a) * Math.cos(b),
    Math.sin(b),
    (direction < 0 ? -1 : 1) * Math.cos(a) * Math.cos(b),
  ];
}

/** Plane ∩ finite nominal cylinder. Side arcs use adaptive chords (≤0.01 mm sagitta); caps are exact lines. */
export function implantPlaneSection(
  start: Point3,
  end: Point3,
  radius: number,
  origin: Point3,
  normal: Point3
): Point3[] {
  const delta = sub(end, start),
    length = Math.hypot(...delta),
    n = unit(normal);
  if (
    length < 1e-6 ||
    radius <= 0 ||
    ![...start, ...end, ...origin, ...normal, radius].every(Number.isFinite) ||
    Math.hypot(...normal) < 1e-6
  )
    return [];
  const axis = unit(delta),
    d = dot(axis, n),
    h = dot(sub(origin, start), n);
  if (Math.abs(d) < 1e-8) {
    if (Math.abs(h) >= radius) return [];
    const width = Math.sqrt(Math.max(0, radius * radius - h * h)),
      side = unit(cross(axis, n));
    const at = (t: number, w: number): Point3 =>
      start.map((v, i) => v + n[i] * h + axis[i] * t + side[i] * w) as Point3;
    return [at(0, -width), at(length, -width), at(length, width), at(0, width)];
  }
  const centerT = h / d,
    center = start.map((v, i) => v + axis[i] * centerT) as Point3;
  let major = unit(axis.map((v, i) => v - d * n[i]) as Point3);
  if (Math.hypot(...axis.map((v, i) => v - d * n[i])) < 1e-8)
    major = unit(cross(n, Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
  const minor = unit(cross(n, major)),
    majorR = radius / Math.abs(d),
    tRadius = majorR * dot(major, axis);
  const point = (theta: number): Point3 =>
    center.map(
      (v, i) => v + major[i] * majorR * Math.cos(theta) + minor[i] * radius * Math.sin(theta)
    ) as Point3;
  const breaks = [0, Math.PI, 2 * Math.PI];
  if (Math.abs(tRadius) > 1e-10)
    for (const cap of [0, length]) {
      const c = (cap - centerT) / tRadius;
      if (c > -1 && c < 1) {
        const a = Math.acos(c);
        breaks.push(a, 2 * Math.PI - a);
      }
    }
  breaks.sort((a, b) => a - b);
  const result: Point3[] = [];
  const arc = (a: number, b: number, pa: Point3, pb: Point3, depth = 0) => {
    const middle = (a + b) / 2,
      pm = point(middle);
    if (depth < 14 && Math.hypot(...pm.map((v, i) => v - (pa[i] + pb[i]) / 2)) > 0.01) {
      arc(a, middle, pa, pm, depth + 1);
      arc(middle, b, pm, pb, depth + 1);
    } else result.push(pb);
  };
  for (let i = 1; i < breaks.length; i++) {
    const a = breaks[i - 1],
      b = breaks[i],
      t = centerT + tRadius * Math.cos((a + b) / 2);
    if (t < -1e-7 || t > length + 1e-7 || b - a < 1e-12) continue;
    const pa = point(a),
      pb = point(b);
    result.push(pa);
    arc(a, b, pa, pb);
  }
  return result.length >= 3 ? result : [];
}
