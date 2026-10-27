import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Interior bounds of the learning commons in metres. The garden glazing runs along -x, the
 * studio cabinetry along -z, the library and lockers along +z, the movement room and dining along +x.
 */
export const ROOM = { minX: -11, maxX: 11, minZ: -7, maxZ: 7, height: 3.6 };

/** Direction the sun shines from: low morning sun over the garden, raking in through the glazing. */
export const SUN_DIRECTION = new THREE.Vector3(-0.8, 0.5, -0.33).normalize();

// ------------------------------------------------------------------ utilities

/** Small seeded PRNG so the scene looks the same on every load. */
function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(width, height, draw, { color = true, repeat } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
  }
  return texture;
}

/**
 * Soft cushion: a subdivided box with rounded edges whose faces bulge outwards. With puff 0 it is
 * simply a box with properly rounded edges, used for every hard piece too so nothing looks blocky.
 * UVs are projected per vertex along the dominant normal axis, in metres.
 */
function cushionGeometry(w, h, d, { radius = 0.06, puff = 0.03, step = 0.04 } = {}) {
  const seg = (size) => Math.max(4, Math.ceil(size / step));
  let g = new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);

  const pos = g.attributes.position;
  const p = new THREE.Vector3();
  const c = new THREE.Vector3();
  const r = Math.min(radius, w / 2, h / 2, d / 2);
  const max = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r);
  const min = max.clone().negate();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const nx = p.x / (w / 2);
    const ny = p.y / (h / 2);
    const nz = p.z / (d / 2);
    c.copy(p).clamp(min, max);
    const offset = p.clone().sub(c);
    if (offset.lengthSq() > 0) p.copy(c).add(offset.normalize().multiplyScalar(r));
    p.x += Math.sign(nx) * puff * Math.abs(nx) ** 3 * (1 - ny * ny) * (1 - nz * nz);
    p.y += Math.sign(ny) * puff * Math.abs(ny) ** 3 * (1 - nx * nx) * (1 - nz * nz);
    p.z += Math.sign(nz) * puff * Math.abs(nz) ** 3 * (1 - nx * nx) * (1 - ny * ny);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();

  const normal = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(normal.getX(i));
    const ay = Math.abs(normal.getY(i));
    const az = Math.abs(normal.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [pos.getX(i), pos.getZ(i)] : ax >= az ? [pos.getZ(i), pos.getY(i)] : [pos.getX(i), pos.getY(i)];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Closed polyline with every corner rounded off, for bent-tube furniture frames. */
function roundedLoop(points, radius) {
  const path = new THREE.CurvePath();
  const n = points.length;
  const corners = points.map((p, i) => {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    return [p.clone().add(prev.clone().sub(p).setLength(radius)), p, p.clone().add(next.clone().sub(p).setLength(radius))];
  });
  corners.forEach(([, p, b], i) => {
    path.add(new THREE.QuadraticBezierCurve3(corners[i][0], p, b));
    path.add(new THREE.LineCurve3(b, corners[(i + 1) % n][0]));
  });
  return path;
}

// ------------------------------------------------------------------ textures

function drawNoise(rand, base = 128, spread = 40) {
  return (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = base + (rand() - 0.5) * spread;
      img.data.set([v, v, v, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
  };
}

function drawFabric(rand) {
  return (g, w, h) => {
    drawNoise(rand, 128, 50)(g, w, h);
    g.globalAlpha = 0.18;
    for (let y = 0; y < h; y += 4) {
      g.fillStyle = y % 8 ? '#000' : '#fff';
      g.fillRect(0, y, w, 2);
    }
    for (let x = 0; x < w; x += 4) {
      g.fillStyle = x % 8 ? '#fff' : '#000';
      g.fillRect(x, 0, 2, h);
    }
    g.globalAlpha = 1;
  };
}

/** Long light-oak floor planks; near-neutral so the material colour tints them. */
function drawPlanks(rand) {
  return (g, w, h) => {
    const rows = 8;
    const rowH = h / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      let x = -rand() * w * 0.5;
      while (x < w) {
        const len = w * (0.45 + rand() * 0.4);
        g.fillStyle = `hsl(32, ${8 + rand() * 6}%, ${82 + rand() * 9}%)`;
        g.fillRect(x, y, len, rowH);
        for (let n = 0; n < 10; n++) {
          g.strokeStyle = `rgba(110, 80, 50, ${0.04 + rand() * 0.07})`;
          g.lineWidth = 0.6 + rand() * 1.6;
          const gy = y + rand() * rowH;
          g.beginPath();
          g.moveTo(x, gy);
          g.bezierCurveTo(x + len / 3, gy + (rand() - 0.5) * 10, x + (2 * len) / 3, gy + (rand() - 0.5) * 10, x + len, gy);
          g.stroke();
        }
        g.fillStyle = 'rgba(90, 65, 40, 0.3)';
        g.fillRect(x, y, 1.5, rowH);
        x += len;
      }
      g.fillStyle = 'rgba(90, 65, 40, 0.3)';
      g.fillRect(0, y, w, 1.5);
    }
  };
}

function drawGrass(rand) {
  return (g, w, h) => {
    g.fillStyle = '#6f9a4c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `hsla(${85 + rand() * 25}, ${35 + rand() * 20}%, ${28 + rand() * 22}%, 0.6)`;
      g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 2 + rand() * 5);
    }
  };
}

const SANS = 'system-ui, "Segoe UI", sans-serif';

function drawDisplay(g, w, h) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1d4f7a');
  grad.addColorStop(1, '#2f7fa8');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffffff';
  g.font = `600 64px ${SANS}`;
  g.fillText('The Water Cycle', 70, 110);
  g.font = `32px ${SANS}`;
  g.globalAlpha = 0.85;
  g.fillText('How water moves between land, sea and sky', 70, 165);
  g.globalAlpha = 1;
  // Diagram: sea, mountain, cloud, arrows.
  g.fillStyle = '#7cc4e8';
  g.fillRect(0, h - 140, w * 0.55, 140);
  g.fillStyle = '#5b8f4a';
  g.beginPath();
  g.moveTo(w * 0.5, h);
  g.lineTo(w * 0.78, h * 0.45);
  g.lineTo(w, h * 0.7);
  g.lineTo(w, h);
  g.fill();
  g.fillStyle = '#ffffff';
  for (const [x, y, r] of [[640, 250, 55], [700, 225, 70], [770, 255, 50]]) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffd34d';
  g.beginPath();
  g.arc(w - 120, 110, 55, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 6;
  g.setLineDash([16, 12]);
  g.beginPath();
  g.moveTo(300, h - 160);
  g.quadraticCurveTo(380, 330, 600, 290);
  g.moveTo(820, 300);
  g.quadraticCurveTo(900, 360, 880, h * 0.5);
  g.stroke();
  g.setLineDash([]);
}

/** Fine, neutral flecks: tinted by the material colour into terrazzo. */
function drawTerrazzo(rand) {
  return (g, w, h) => {
    g.fillStyle = '#f1ede6';
    g.fillRect(0, 0, w, h);
    const chips = ['#d6cdc0', '#c4b9aa', '#fbf9f5', '#b3aa9e', '#dcbca5', '#a49d94', '#e6dfd4'];
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = chips[Math.floor(rand() * chips.length)];
      const x = rand() * w;
      const y = rand() * h;
      const r = 1.5 + rand() ** 3 * 9;
      g.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + rand();
        const rr = r * (0.6 + rand() * 0.6);
        g[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.fill();
    }
  };
}

/** Polished concrete: soft clouding with a scatter of fine aggregate. */
function drawConcrete(rand) {
  return (g, w, h) => {
    g.fillStyle = '#dcdad6';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = 40 + rand() * 160;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const tone = rand() < 0.5 ? '255,255,255' : '120,118,114';
      grad.addColorStop(0, `rgba(${tone},${0.05 + rand() * 0.08})`);
      grad.addColorStop(1, `rgba(${tone},0)`);
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = `rgba(${rand() < 0.5 ? '90,88,84' : '250,250,248'},${0.15 + rand() * 0.25})`;
      g.fillRect(rand() * w, rand() * h, 1 + rand() * 1.5, 1 + rand() * 1.5);
    }
  };
}

/** Soft-play rubber tiles with faint seams. */
function drawTiles(rand) {
  return (g, w, h) => {
    drawNoise(rand, 236, 14)(g, w, h);
    g.fillStyle = 'rgba(120, 90, 60, 0.18)';
    for (let i = 0; i <= 2; i++) {
      g.fillRect((i * w) / 2 - 1, 0, 2, h);
      g.fillRect(0, (i * h) / 2 - 1, w, 2);
    }
  };
}

/** Subtle vinyl sheet floor: near-white speckle so the material colour carries it. */
function drawVinyl(rand) {
  return (g, w, h) => {
    drawNoise(rand, 238, 10)(g, w, h);
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = `rgba(${rand() < 0.5 ? '170,160,145' : '255,255,255'},0.35)`;
      g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
    }
  };
}

/** Straight-grained timber, one metre per tile. */
function drawGrain(rand) {
  return (g, w, h) => {
    g.fillStyle = '#efe6da';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = rand() * w;
      g.strokeStyle = `rgba(120, 85, 50, ${0.03 + rand() * 0.07})`;
      g.lineWidth = 0.5 + rand() * 2.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + (rand() - 0.5) * 14, h / 3, x + (rand() - 0.5) * 14, (2 * h) / 3, x + (rand() - 0.5) * 8, h);
      g.stroke();
    }
  };
}

function drawMoss(rand) {
  return (g, w, h) => {
    g.fillStyle = '#4f6b2e';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14000; i++) {
      g.fillStyle = `hsl(${78 + rand() * 30}, ${35 + rand() * 25}%, ${22 + rand() * 30}%)`;
      g.beginPath();
      g.arc(rand() * w, rand() * h, 1 + rand() * 2.5, 0, Math.PI * 2);
      g.fill();
    }
  };
}

/** Basket weave, used as both colour and bump on woven ottomans. */
function drawWeave(g, w, h) {
  g.fillStyle = '#d9d2c6';
  g.fillRect(0, 0, w, h);
  const n = 16;
  const s = w / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const across = (x + y) % 2 === 0;
      const grad = across ? g.createLinearGradient(0, y * s, 0, (y + 1) * s) : g.createLinearGradient(x * s, 0, (x + 1) * s, 0);
      grad.addColorStop(0, '#8d8576');
      grad.addColorStop(0.5, '#ffffff');
      grad.addColorStop(1, '#8d8576');
      g.fillStyle = grad;
      g.fillRect(x * s + 1, y * s + 1, s - 2, s - 2);
    }
  }
}

/** Perforated acoustic board: white field with a dark hole grid, tinted by the material. */
function drawPerforated(g, w, h) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0, 0, 0, 0.55)';
  const step = w / 24;
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      g.beginPath();
      g.arc(x, y, step * 0.22, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** Oriented strand board for the reading-bay backs. */
function drawStrand(rand) {
  return (g, w, h) => {
    g.fillStyle = '#c99a62';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      g.save();
      g.translate(rand() * w, rand() * h);
      g.rotate(rand() * Math.PI);
      g.fillStyle = `hsl(${28 + rand() * 12}, ${40 + rand() * 20}%, ${45 + rand() * 25}%)`;
      g.fillRect(-12 - rand() * 14, -3 - rand() * 3, 24 + rand() * 28, 6 + rand() * 6);
      g.restore();
    }
  };
}

/** Traditional rug for the movement room: border bands, field and a central medallion. */
function drawRug(rand) {
  return (g, w, h) => {
    g.fillStyle = '#efe4d2';
    g.fillRect(0, 0, w, h);
    const band = (inset, color, width) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
    };
    band(14, '#8f2f2a', 18);
    band(40, '#c9a46a', 6);
    band(62, '#8f2f2a', 10);
    g.fillStyle = '#b5473b';
    g.fillRect(84, 84, w - 168, h - 168);
    g.fillStyle = '#efe4d2';
    for (let i = 0; i < 220; i++) {
      const x = 100 + rand() * (w - 200);
      const y = 100 + rand() * (h - 200);
      g.globalAlpha = 0.35;
      g.beginPath();
      g.arc(x, y, 3 + rand() * 6, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.save();
    g.translate(w / 2, h / 2);
    for (const [r, color] of [[0.3, '#efe4d2'], [0.24, '#2f4a6b'], [0.16, '#c9a46a'], [0.08, '#8f2f2a']]) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, -h * r);
      g.lineTo(w * r * 0.7, 0);
      g.lineTo(0, h * r);
      g.lineTo(-w * r * 0.7, 0);
      g.closePath();
      g.fill();
    }
    g.restore();
  };
}

/** Plain round rug with a soft border ring. */
function drawRingRug(inner, outer) {
  return (g, w) => {
    const c = w / 2;
    g.fillStyle = outer;
    g.beginPath();
    g.arc(c, c, c, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = inner;
    g.beginPath();
    g.arc(c, c, c * 0.9, 0, Math.PI * 2);
    g.fill();
  };
}

/** Picture-book cover for face-out display. */
function drawCover(rand, color) {
  return (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(w * 0.12, h * 0.1, w * 0.76, h * 0.14);
    for (let i = 0; i < 3; i++) {
      g.fillStyle = `hsl(${rand() * 360}, 60%, ${55 + rand() * 20}%)`;
      g.beginPath();
      g.arc(w * (0.25 + rand() * 0.5), h * (0.45 + rand() * 0.35), w * (0.1 + rand() * 0.15), 0, Math.PI * 2);
      g.fill();
    }
  };
}

// ------------------------------------------------------------------ shape helpers

/** Shape from world [x, z] points; extrudeUp turns shape (x, -z) back into world (x, z). */
function shapeXZ(points, path = new THREE.Shape()) {
  points.forEach(([x, z], i) => (i ? path.lineTo(x, -z) : path.moveTo(x, -z)));
  return path;
}
function shapeXY(points, path = new THREE.Shape()) {
  points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  return path;
}

const ellipsePoints = (a, b, from = 0, to = Math.PI * 2, steps = 96, cx = 0, cz = 0) => {
  const closed = to - from >= Math.PI * 2 - 1e-6;
  const pts = [];
  for (let i = 0; i < (closed ? steps : steps + 1); i++) {
    const t = from + ((to - from) * i) / steps;
    pts.push([cx + Math.cos(t) * a, cz + Math.sin(t) * b]);
  }
  return pts;
};

/** Elliptical ring (or a sector of one) in the xz plane. */
function ellipseRing(a0, b0, a1, b1, from = 0, to = Math.PI * 2, steps = 96) {
  if (to - from >= Math.PI * 2 - 1e-6) {
    const s = shapeXZ(ellipsePoints(a1, b1, 0, Math.PI * 2, steps));
    s.holes.push(shapeXZ(ellipsePoints(a0, b0, 0, Math.PI * 2, steps), new THREE.Path()));
    return s;
  }
  return shapeXZ([...ellipsePoints(a1, b1, from, to, steps), ...ellipsePoints(a0, b0, from, to, steps).reverse()]);
}

/** Polygon in the xz plane with every corner rounded. */
function roundedShape(points, radius) {
  const s = new THREE.Shape();
  const n = points.length;
  const toward = (p, q) => {
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const k = Math.min(radius, Math.hypot(dx, dz) / 2) / Math.hypot(dx, dz);
    return [p[0] + dx * k, p[1] + dz * k];
  };
  points.forEach((p, i) => {
    const a = toward(p, points[(i - 1 + n) % n]);
    const b = toward(p, points[(i + 1) % n]);
    if (i) s.lineTo(a[0], -a[1]);
    else s.moveTo(a[0], -a[1]);
    s.quadraticCurveTo(p[0], -p[1], b[0], -b[1]);
  });
  s.closePath();
  return s;
}
const rectPoints = (w, d, cx = 0, cz = 0) => [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];

/** Arch outline in the xy plane: a rectangle with a semicircular head, base at y0. */
function archPoints(cx, y0, w, h, steps = 40) {
  const r = w / 2;
  const spring = y0 + h - r;
  const pts = [[cx - r, y0], [cx + r, y0]];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI;
    pts.push([cx + Math.cos(t) * r, spring + Math.sin(t) * r]);
  }
  return pts;
}
const circlePoints = (cx, cy, r, steps = 72) => ellipsePoints(r, r, 0, Math.PI * 2, steps, cx, cy);

/** Extrudes an xz shape upwards from y = 0 to `height`, with softly bevelled edges. */
function extrudeUp(shape, height, bevel = 0.012, curveSegments = 24) {
  const b = Math.min(bevel, height / 2.5);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: height - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments,
  });
  g.translate(0, 0, b);
  g.rotateX(-Math.PI / 2);
  return g;
}
/** Extrudes an xy shape along +z (towards the room for front-wall pieces). */
function extrudeOut(shape, depth, bevel = 0.006, curveSegments = 24) {
  const b = Math.min(bevel, depth / 2.5);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: depth - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments,
  });
  g.translate(0, 0, b);
  return g;
}

/** Rounded puck (stools, ottomans, pads): a lathe with filleted top and bottom edges. */
function puckGeometry(r, h, round = 0.05, segments = 64) {
  const f = Math.min(round, r, h / 2);
  const pts = [new THREE.Vector2(0, 0)];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - f + Math.cos(a) * f, f + Math.sin(a) * f));
  }
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - f + Math.cos(a) * f, h - f + Math.sin(a) * f));
  }
  pts.push(new THREE.Vector2(0, h));
  return new THREE.LatheGeometry(pts, segments);
}

/** Slumped bean bag. */
function beanGeometry(rand) {
  const g = new THREE.SphereGeometry(0.42, 40, 28);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.y *= 0.72;
    if (v.y < -0.16) v.y = -0.16 + (v.y + 0.16) * 0.15;
    const r = Math.hypot(v.x, v.z);
    const swell = 1 + 0.14 * Math.max(0, 1 - Math.abs(v.y + 0.12) / 0.2);
    v.x *= swell;
    v.z *= swell;
    if (v.y > 0.08) v.y -= 0.09 * Math.max(0, 1 - r / 0.28);
    v.addScaledVector(v.clone().normalize(), (rand() - 0.5) * 0.008);
    p.setXYZ(i, v.x, v.y + 0.18, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Smooth pebble-shaped floor cushion. */
function pebbleGeometry() {
  const g = new THREE.SphereGeometry(0.34, 48, 24);
  g.scale(1, 0.55, 0.82);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < -0.1) p.setY(i, -0.1 + (y + 0.1) * 0.2);
  }
  g.translate(0, 0.115, 0);
  g.computeVertexNormals();
  return g;
}

/**
 * Batch static geometry within each item, preserving ownership for picking and isolated views.
 */
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    let owner = o;
    while (owner && !owner.userData.itemId) owner = owner.parent;
    const flags = { noPick: !!o.userData.noPick, floor: !!o.userData.floor, itemId: owner?.userData.itemId ?? null };
    const key = [o.material.uuid, o.castShadow, o.receiveShadow, flags.noPick, flags.floor, flags.itemId].join('|');
    if (!buckets.has(key)) buckets.set(key, { material: o.material, cast: o.castShadow, receive: o.receiveShadow, flags, meshes: [] });
    buckets.get(key).meshes.push(o);
  });
  const merged = new THREE.Group();
  for (const b of buckets.values()) {
    const geometries = b.meshes.map((m) => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.clearGroups();
      g.applyMatrix4(m.matrixWorld);
      return g;
    });
    const mesh = new THREE.Mesh(mergeGeometries(geometries), b.material);
    geometries.forEach((g) => g.dispose());
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    Object.assign(mesh.userData, b.flags);
    merged.add(mesh);
    b.meshes.forEach((m) => m.removeFromParent());
  }
  root.clear();
  root.add(merged);
}

// ------------------------------------------------------------------ material options

const plain = (name, color, roughness, metalness = 0) => ({ name, color, roughness, metalness });
const wood = (name, color, roughness = 0.55) => ({
  ...plain(name, color, roughness),
  swatch: `repeating-linear-gradient(100deg, ${color} 0 6px, color-mix(in srgb, ${color} 84%, #000) 6px 8px)`,
});
const fabric = (name, color) => ({
  ...plain(name, color, 0.95),
  swatch: `repeating-linear-gradient(45deg, ${color} 0 3px, color-mix(in srgb, ${color} 88%, #000) 3px 4px)`,
});

const KIDZINK_RED = '#e43d2f';
const fabrics = (list) => list.map(([n, c]) => fabric(n, c));

/** Finishes offered in the material palette for each configurable piece. */
export const OPTIONS = {
  timber: [wood('Natural oak', '#d8b285'), wood('Birch', '#ead2ad'), wood('Ash', '#e0c7a3'), wood('Teak', '#b98656'), wood('Walnut', '#86593a')],
  column: [wood('Natural oak', '#cfa77a'), wood('Birch', '#ead2ad'), plain('Chalk', '#f1eee8', 0.6), plain('Kidzink red', KIDZINK_RED, 0.6)],
  pit: fabrics([['Terracotta', '#c9785f'], ['Blush', '#e3a99a'], ['Mustard', '#d9a53a'], ['Teal', '#2f8f8a'], ['Sage', '#9bb59a'], ['Kidzink red', KIDZINK_RED]]),
  floorCushion: fabrics([['Oxblood', '#8e3b34'], ['Navy', '#2b3a63'], ['Ochre', '#c08a2f'], ['Oatmeal', '#d8cbb6']]),
  kidChair: [wood('Beech', '#e3c398'), wood('Birch', '#efdcbc'), plain('Chalk', '#f2f0eb', 0.5), plain('Sky', '#9cc6df', 0.5), plain('Kidzink red', KIDZINK_RED, 0.5)],
  studioTop: [plain('Chalk', '#f7f6f2', 0.35), wood('Oak', '#d8b285'), plain('Mint', '#cfe6dc', 0.4), plain('Butter', '#f4e3b2', 0.4)],
  nook: [plain('Navy', '#22335f', 0.6), plain('Kidzink red', KIDZINK_RED, 0.6), plain('Teal', '#2f7f88', 0.6), plain('Sage', '#8ea98a', 0.6), plain('Mustard', '#d9a53a', 0.6)],
  pod: [plain('Sky blue', '#2c8fc0', 0.45), plain('Mint', '#7fd3c4', 0.45), plain('Kidzink red', KIDZINK_RED, 0.45), plain('Mustard', '#e0a933', 0.45), plain('Chalk', '#f2f0eb', 0.45)],
  bench: fabrics([['Stone', '#cfc3b2'], ['Teal', '#2f8f8a'], ['Navy', '#2b3a63'], ['Terracotta', '#c9785f'], ['Sage', '#9bb59a']]),
  bean: fabrics([['Lagoon', '#3aa6b9'], ['Mint', '#7fcfc2'], ['Ocean', '#2f7fb0'], ['Mustard', '#d9a53a'], ['Kidzink red', KIDZINK_RED], ['Oatmeal', '#d8cbb6']]),
  pebble: fabrics([['Pebble', '#d9d4cc'], ['Cloud', '#efece6'], ['Stone', '#c8c2b8'], ['Sage', '#b7c7b0'], ['Blush', '#e8c9bd']]),
  stool: fabrics([['Terracotta', '#c46f55'], ['Rust', '#a85339'], ['Sand', '#d8b285'], ['Teal', '#2f8f8a'], ['Kidzink red', KIDZINK_RED]]),
  seat: fabrics([['Brick', '#a8392c'], ['Kidzink red', KIDZINK_RED], ['Mustard', '#d9a53a'], ['Olive', '#6f7445'], ['Navy', '#2b3a63']]),
  woven: fabrics([['Rattan', '#c9a37a'], ['Terracotta', '#b4673f'], ['Charcoal', '#6d6d6a'], ['Sand', '#e0cfb0']]),
  sofa: [plain('Navy', '#24345e', 0.55), plain('Teal', '#2f7f88', 0.55), plain('Cognac', '#9a5a32', 0.55), plain('Kidzink red', KIDZINK_RED, 0.55)],
  rings: [plain('Mint', '#86c7bd', 0.7), plain('Teal', '#4fa59b', 0.7), plain('Sky', '#9cc6df', 0.7), plain('Butter', '#f0d98c', 0.7), plain('Blush', '#efb6a8', 0.7)],
  tiers: fabrics([['Moss', '#7f9a5a'], ['Sage', '#a3b68e'], ['Teal', '#2f8f8a'], ['Terracotta', '#c9785f'], ['Kidzink red', KIDZINK_RED]]),
  counter: [plain('Snow', '#f4f2ee', 0.3), plain('Chalk', '#e9e4dc', 0.35), wood('Oak', '#d8b285')],
  inlay: [plain('Moss', '#7c9a4c', 0.4), plain('Kidzink red', KIDZINK_RED, 0.4), plain('Teal', '#2f8f8a', 0.4), plain('Mustard', '#d9a53a', 0.4)],
  acoustic: [plain('Olive', '#6f7445', 0.9), plain('Sage', '#9bb59a', 0.9), plain('Terracotta', '#b96a4c', 0.9), plain('Stone', '#bdb6aa', 0.9)],
  lockers: [plain('Chalk', '#f5f4f0', 0.4), plain('Sage', '#c5d3c0', 0.45), plain('Sky', '#c7dbe8', 0.45), plain('Sand', '#e8dcc6', 0.45)],
  slats: [plain('Terracotta', '#c0603f', 0.7), plain('Kidzink red', KIDZINK_RED, 0.7), plain('Olive', '#6f7445', 0.7), wood('Oak', '#d8b285')],
  walls: [plain('Warm white', '#f3efe8', 0.95), plain('Pure white', '#f8f8f6', 0.95), plain('Linen', '#ece2d2', 0.95), plain('Blush', '#f3ddd3', 0.95), plain('Mist', '#e3eaec', 0.95)],
};

// ------------------------------------------------------------------ builder

/**
 * Builds the learning commons. Returns:
 *   group  – everything, ready to add to the scene
 *   update – per-frame hook (dt), kept for animated details
 * Floor meshes carry userData.floor; glass and the garden carry userData.noPick so clicks pass through.
 * Configurable materials carry userData.configurable = { set, option } where set is
 * { id, label, options, materials, each } – `each` means a change applies only to the clicked material.
 */
export function buildCommons() {
  const rand = seededRandom(20261027);
  const root = new THREE.Group();
  const { minX, maxX, minZ, maxZ, height: H } = ROOM;
  const W = maxX - minX;
  const D = maxZ - minZ;
  const T = 0.2; // wall thickness
  const itemLabels = new Map();
  const item = (label, objects) => {
    const id = `item-${itemLabels.size + 1}`;
    itemLabels.set(id, label);
    for (const object of Array.isArray(objects) ? objects : [objects]) object.userData.itemId = id;
    return objects;
  };

  // ---------------------------------------------------------------- helpers

  const place = (parent, mesh, [x, y, z], { rotation, shadow = true } = {}) => {
    mesh.position.set(x, y, z);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const mesh = (parent, geometry, material, position, options) => place(parent, new THREE.Mesh(geometry, material), position, options);
  const box = (parent, [w, h, d], material, position, options) => mesh(parent, new THREE.BoxGeometry(w, h, d), material, position, options);
  /** Rounded box (puff 0) or cushion (puff > 0). */
  const soft = (parent, size, material, position, options = {}) =>
    mesh(parent, cushionGeometry(...size, { step: 0.06, ...options }), material, position, options);
  const cylinder = (parent, [rTop, rBottom, h, segments = 48], material, position, options) =>
    mesh(parent, new THREE.CylinderGeometry(rTop, rBottom, h, segments), material, position, options);
  const UP = new THREE.Vector3(0, 1, 0);
  const rod = (parent, a, b, radius, material, options) => {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const dir = end.clone().sub(start);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 12), material);
    m.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
    return place(parent, m, start.add(end).multiplyScalar(0.5).toArray(), options);
  };
  const group = (parent, [x, y, z] = [0, 0, 0], rotationY = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotationY;
    parent.add(g);
    return g;
  };
  /** Rotation that turns a local -z-facing piece at (x, z) towards (cx, cz). */
  const facing = (x, z, cx, cz) => Math.atan2(x - cx, z - cz);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const floorPatch = (shape, material, y) => {
    const m = mesh(root, new THREE.ShapeGeometry(shape, 24).rotateX(-Math.PI / 2), material, [0, y, 0], { shadow: false });
    m.userData.floor = true;
    return m;
  };

  // ---------------------------------------------------------------- materials

  const fabricBump = canvasTexture(256, 256, drawFabric(rand), { color: false, repeat: [8, 8] });
  const speckle = canvasTexture(256, 256, drawNoise(rand, 128, 24), { color: false, repeat: [3, 3] });
  const grain = canvasTexture(512, 512, drawGrain(rand), { repeat: [1, 1] });
  const weave = canvasTexture(256, 256, drawWeave, { repeat: [3, 2] });

  const std = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...options });
  const cloth = (color, options = {}) => new THREE.MeshPhysicalMaterial({
    color, roughness: 0.95, bumpMap: fabricBump, bumpScale: 2.5,
    sheen: 1, sheenRoughness: 0.7, sheenColor: new THREE.Color('#ffffff').multiplyScalar(0.35), ...options,
  });
  const timber = (color) => std(color, { map: grain, roughness: 0.55, bumpMap: speckle, bumpScale: 0.25 });
  const glow = (color, intensity) => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: color, emissiveIntensity: intensity });
  const floorMap = (draw, size, tile) => canvasTexture(size, size, draw, { repeat: [1 / tile, 1 / tile] });

  const M = {
    wall: std('#f3efe8', { roughness: 0.95 }),
    ceiling: std('#f7f5f1', { roughness: 1, emissive: '#fff8ef', emissiveIntensity: 0.18 }),
    vinyl: std('#e6dccb', { map: floorMap(drawVinyl(rand), 512, 3), roughness: 0.42 }),
    oakFloor: std('#e8c9a0', { map: floorMap(drawPlanks(rand), 2048, 4.8), roughness: 0.4 }),
    terrazzo: std('#ffffff', { map: floorMap(drawTerrazzo(rand), 1024, 2.4), roughness: 0.3 }),
    concrete: std('#ffffff', { map: floorMap(drawConcrete(rand), 1024, 4), roughness: 0.32 }),
    rubber: std('#e2c398', { map: floorMap(drawTiles(rand), 256, 2), roughness: 0.85 }),
    timber: timber('#d8b285'),
    column: timber('#cfa77a'),
    darkTimber: timber('#a77b52'),
    frameDark: std('#2b2c2e', { roughness: 0.45, metalness: 0.5 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: '#eef6fa', roughness: 0, transparent: true, opacity: 0.1, depthWrite: false, envMapIntensity: 1.5, side: THREE.DoubleSide,
    }),
    pit: cloth('#c9785f'),
    floorCushion: cloth('#8e3b34'),
    kidChair: timber('#e3c398'),
    studioTop: std('#f7f6f2', { roughness: 0.35 }),
    nook: std('#22335f', { roughness: 0.6, side: THREE.DoubleSide }),
    nookCushion: cloth('#9fc3cf'),
    pods: ['#2c8fc0', '#7fd3c4'].map((c) => std(c, { roughness: 0.45, side: THREE.DoubleSide })),
    podInner: [cloth('#2c6f8f'), cloth('#4fae9f')],
    bench: cloth('#cfc3b2'),
    beans: ['#3aa6b9', '#7fcfc2', '#2f7fb0'].map((c) => cloth(c)),
    pebbles: ['#d9d4cc', '#efece6', '#c8c2b8'].map((c) => cloth(c)),
    stools: ['#c46f55', '#a85339'].map((c) => cloth(c)),
    seat: cloth('#a8392c'),
    woven: ['#c9a37a', '#b4673f', '#6d6d6a'].map((c) => std(c, { map: weave, bumpMap: weave, bumpScale: 3, roughness: 0.9 })),
    sofa: std('#24345e', { roughness: 0.55, bumpMap: speckle, bumpScale: 0.4 }),
    rings: ['#86c7bd', '#4fa59b'].map((c) => std(c, { roughness: 0.7, bumpMap: speckle, bumpScale: 0.3 })),
    tiers: cloth('#7f9a5a'),
    counter: std('#f4f2ee', { roughness: 0.3 }),
    inlay: std('#7c9a4c', { roughness: 0.4 }),
    acoustic: std('#6f7445', { map: canvasTexture(256, 256, drawPerforated, { repeat: [2, 2] }), roughness: 0.9 }),
    lockers: std('#f5f4f0', { roughness: 0.4 }),
    slats: std('#c0603f', { roughness: 0.7 }),
    strand: std('#ffffff', { map: canvasTexture(512, 512, drawStrand(rand), { repeat: [1, 1] }), roughness: 0.85 }),
    olive: std('#6f7445', { roughness: 0.6 }),
    moss: std('#ffffff', { map: canvasTexture(512, 512, drawMoss(rand)), roughness: 1, bumpMap: speckle, bumpScale: 3 }),
    ballBlue: new THREE.MeshPhysicalMaterial({ color: '#1f5fbf', roughness: 0.25, clearcoat: 0.6 }),
    blackGloss: std('#111214', { roughness: 0.15, metalness: 0.2 }),
    aluminium: std('#c9ced3', { metalness: 0.85, roughness: 0.3 }),
    rubberBlack: std('#2a2a2c', { roughness: 0.9 }),
    lantern: new THREE.MeshStandardMaterial({ color: '#fffaf0', emissive: '#ffe9c8', emissiveIntensity: 1.6, roughness: 0.9 }),
    led: glow('#fff1dc', 3.2),
    chandelier: glow('#ffe2b0', 4),
    downlight: glow('#fff6ea', 2.4),
    leaf: std('#4d7a3c', { roughness: 0.6, side: THREE.DoubleSide }),
    potWhite: std('#eeebe6', { roughness: 0.7 }),
    grass: std('#ffffff', { map: canvasTexture(512, 512, drawGrass(rand), { repeat: [80, 80] }), roughness: 1 }),
    paving: std('#d9d5cc', { roughness: 0.85, bumpMap: speckle, bumpScale: 1 }),
    foliage: std('#5c8a45', { roughness: 0.9, bumpMap: speckle, bumpScale: 2 }),
    foliageDark: std('#456f38', { roughness: 0.9, bumpMap: speckle, bumpScale: 2 }),
    bark: std('#6a5544', { roughness: 1 }),
  };
  const bookColours = ['#c0392b', '#2471a3', '#239b56', '#d4ac0d', '#7d3c98', '#ca6f1e', '#1abc9c', '#34495e', '#e8e2d6', '#f2a7a0']
    .map((c) => std(c, { roughness: 0.7 }));
  const covers = ['#f6c445', '#4aa3df', '#e8705f', '#7cc576', '#b38fd6', '#f29e4c'].map((c) =>
    std('#ffffff', { map: canvasTexture(128, 170, drawCover(rand, c)), roughness: 0.6 }));
  const bagColours = ['#e43d2f', '#2b3a63', '#f2a7a0', '#3aa6b9', '#d9a53a', '#7d3c98'].map((c) => std(c, { roughness: 0.8 }));

  // ---------------------------------------------------------------- floors

  const base = box(root, [W, 0.04, D], M.vinyl, [0, -0.02, 0], { shadow: false });
  base.userData.floor = true;
  floorPatch(roundedShape(rectPoints(4.8, 4.0, -8.5, -3.5), 1.4), M.terrazzo, 0.002);
  const libraryWave = (x) => 2.0 + 0.45 * Math.sin(((x + 11) / 7.8) * Math.PI * 2.2);
  const libraryEdge = [];
  for (let i = 0; i <= 60; i++) {
    const x = -3.0 - (i / 60) * 8.0;
    libraryEdge.push([x, libraryWave(x)]);
  }
  floorPatch(shapeXZ([[-11, 7], [-3.0, 7], ...libraryEdge]), M.oakFloor, 0.002);
  floorPatch(roundedShape([[4.9, -7], [11, -7], [11, -1.0], [4.9, -1.0]], 0.6), M.rubber, 0.002);
  floorPatch(roundedShape([[4.9, 0.9], [11, 0.9], [11, 7], [4.9, 7]], 0.8), M.concrete, 0.002);

  // ---------------------------------------------------------------- shell

  box(root, [W + 2 * T, 0.2, D + 2 * T], M.ceiling, [0, H + 0.1, 0]);
  box(root, [W + 2 * T, H, T], M.wall, [0, H / 2, minZ - T / 2]);
  box(root, [W + 2 * T, H, T], M.wall, [0, H / 2, maxZ + T / 2]);

  // Corridor wall with an arched opening (shape x = -z so the extrusion runs into +x).
  const door = { z: -0.2, w: 1.6, h: 2.7 };
  const spring = door.h - door.w / 2;
  const doorPts = [[-maxZ - T, 0], [-door.z - door.w / 2, 0], [-door.z - door.w / 2, spring]];
  for (let i = 0; i <= 40; i++) {
    const t = Math.PI - (i / 40) * Math.PI;
    doorPts.push([-door.z + Math.cos(t) * (door.w / 2), spring + Math.sin(t) * (door.w / 2)]);
  }
  doorPts.push([-door.z + door.w / 2, 0], [-minZ + T, 0], [-minZ + T, H], [-maxZ - T, H]);
  mesh(root, extrudeOut(shapeXY(doorPts), T, 0), M.wall, [maxX, 0, 0], { rotation: [0, Math.PI / 2, 0] });
  // A glimpse of the corridor beyond the arch.
  const corridor = group(root, [maxX + T, 0, door.z]);
  box(corridor, [3.2, 0.04, 3.4], M.vinyl, [1.6, -0.02, 0], { shadow: false });
  box(corridor, [3.2, 0.1, 3.4], M.ceiling, [1.6, 3.0, 0]);
  box(corridor, [0.1, 3.0, 3.4], M.wall, [3.2, 1.5, 0]);
  for (const s of [-1, 1]) box(corridor, [3.2, 3.0, 0.1], M.wall, [1.6, 1.5, s * 1.7]);
  for (const x of [0.8, 2.2]) mesh(corridor, new THREE.CircleGeometry(0.08, 24).rotateX(Math.PI / 2), M.downlight, [x, 2.94, 0], { shadow: false });
  item('Corridor storage cabinet', soft(corridor, [0.4, 2.2, 1.2], M.timber, [3.0, 1.1, 0.4], { radius: 0.02, puff: 0 }));

  // Garden glazing: slim charcoal mullions and a transom, floor to ceiling.
  const glazingX = minX - 0.04;
  const transom = 2.75;
  const bays = 8;
  for (let i = 0; i < bays; i++) {
    const z0 = minZ + (D * i) / bays;
    const z1 = minZ + (D * (i + 1)) / bays;
    for (const [y0, y1] of [[0.05, transom], [transom, H]]) {
      const pane = box(root, [0.012, y1 - y0 - 0.06, z1 - z0 - 0.06], M.glass, [glazingX, (y0 + y1) / 2, (z0 + z1) / 2], { shadow: false });
      pane.userData.noPick = true;
    }
  }
  for (let i = 0; i <= bays; i++) box(root, [0.08, H, 0.06], M.frameDark, [glazingX, H / 2, minZ + (D * i) / bays]);
  for (const y of [0.025, transom, H - 0.03]) box(root, [0.08, 0.06, D], M.frameDark, [glazingX, y, 0]);
  box(root, [0.3, 0.2, D + 2 * T], M.wall, [minX - 0.15, H - 0.0, 0]);

  // Structural timber columns.
  for (const [x, z] of [[-4.8, -1.6], [4.8, -1.6], [4.6, 4.4], [-2.4, 5.9]]) {
    cylinder(root, [0.32, 0.32, H, 64], M.column, [x, H / 2, z]);
  }

  // ---------------------------------------------------------------- lighting

  const lights = new THREE.Group();
  root.add(lights);
  const lamp = (x, y, z, intensity, color = '#ffeedd') => {
    const l = new THREE.PointLight(color, intensity, 0, 2);
    l.position.set(x, y, z);
    lights.add(l);
  };
  const downlight = (x, z, y = H) => mesh(root, new THREE.CircleGeometry(0.075, 32).rotateX(Math.PI / 2), M.downlight, [x, y - 0.002, z], { shadow: false });
  for (const [x, z] of [
    [-9.6, 0.2], [-7.2, 0.2], [-5.6, -1.0], [-3.4, -0.2], [3.6, -0.6], [3.8, 4.8], [2.0, 5.6], [0.0, 5.6], [-1.6, 4.6],
    [-6.4, -5.8], [-10.2, -1.2], [3.8, -2.4], [-4.4, -4.4], [2.6, -5.8], [-1.0, -2.0], [1.6, -2.0],
  ]) downlight(x, z);
  lamp(0.2, 3.0, 1.4, 7);
  lamp(-7.0, 3.0, 4.6, 6);
  lamp(-0.5, 3.0, -4.6, 6);
  lamp(-8.4, 2.8, -3.6, 4);
  lamp(7.9, 3.0, -3.9, 6);
  lamp(8.0, 3.0, 4.0, 6);
  lamp(maxX + 1.8, 2.6, door.z, 2.5);

  // ---------------------------------------------------------------- books

  /** Fills a shelf span with spine-out books and the odd face-out picture book. Faces local +z. */
  function books(parent, x0, x1, y, depth, zCenter, maxH = 0.3, sparse = 0) {
    let x = x0 + 0.01;
    while (x < x1 - 0.06) {
      const r = rand();
      if (r < sparse) {
        x += 0.12 + rand() * 0.2;
        continue;
      }
      if (r < sparse + 0.08 && x1 - x > 0.24) {
        mesh(parent, new THREE.PlaneGeometry(0.2, 0.26), pick(covers), [x + 0.11, y + 0.135, zCenter + depth * 0.2], { rotation: [-0.12, 0, 0], shadow: false });
        x += 0.24;
        continue;
      }
      const bw = 0.022 + rand() * 0.035;
      const bh = Math.min(maxH, 0.17 + rand() * 0.12);
      const lean = rand() < 0.05 ? 0.2 : 0;
      box(parent, [bw, bh, depth * (0.65 + rand() * 0.15)], pick(bookColours), [x + bw / 2, y + bh / 2, zCenter], { rotation: [0, 0, lean], shadow: false });
      x += bw + 0.003;
    }
  }

  /** Open shelving bay: sides, shelves and books. Faces local +z, base at y 0. */
  function shelving(parent, x0, x1, y0, y1, depth, rows, { sparse = 0.15, material = M.timber } = {}) {
    parent = item('Bookshelf', group(parent));
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    box(parent, [w, y1 - y0, 0.012], M.wall, [cx, (y0 + y1) / 2, -depth / 2 + 0.006]);
    const cols = Math.max(1, Math.round(w / 0.5));
    for (let c = 0; c <= cols; c++) soft(parent, [0.025, y1 - y0, depth], material, [x0 + (w * c) / cols, (y0 + y1) / 2, 0], { radius: 0.006, puff: 0 });
    const step = (y1 - y0) / rows;
    for (let r = 0; r <= rows; r++) soft(parent, [w + 0.025, 0.025, depth], material, [cx, y0 + r * step, 0], { radius: 0.006, puff: 0 });
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        books(parent, x0 + (w * c) / cols + 0.015, x0 + (w * (c + 1)) / cols - 0.015, y0 + r * step + 0.013, depth, 0, step - 0.06, sparse);
      }
    }
  }

  // ---------------------------------------------------------------- learning commons (glazing, front)

  // Tall timber shelving with arched, cushioned window seats between.
  const commonsWall = group(root, [0, 0, minZ + 0.23]);
  const unitDepth = 0.45;
  let ux = minX + 0.15;
  ['shelf', 'seat', 'shelf', 'seat', 'shelf'].forEach((kind) => {
    const firstChild = commonsWall.children.length;
    const w = kind === 'shelf' ? 0.9 : 1.3;
    const cx = ux + w / 2;
    if (kind === 'shelf') {
      soft(commonsWall, [w - 0.04, 0.5, 0.02], M.olive, [cx, 0.27, unitDepth / 2 - 0.01], { radius: 0.006, puff: 0 });
      box(commonsWall, [w, 0.52, unitDepth - 0.04], M.timber, [cx, 0.26, -0.02]);
      shelving(commonsWall, ux, ux + w, 0.54, 2.9, unitDepth, 6, { sparse: 0.45 });
      for (const s of [-1, 1]) box(commonsWall, [0.012, 2.3, 0.012], M.led, [cx + s * (w / 2 - 0.03), 1.72, -unitDepth / 2 + 0.03], { shadow: false });
      for (let r = 0; r < 3; r++) {
        const vase = new THREE.LatheGeometry([[0, 0], [0.06, 0], [0.08, 0.08], [0.05, 0.18], [0.045, 0.2], [0, 0.2]].map(([a, b]) => new THREE.Vector2(a, b)), 32);
        mesh(commonsWall, vase, M.potWhite, [cx + (rand() - 0.5) * 0.4, 0.94 + r * 0.786, 0.02]);
      }
    } else {
      box(commonsWall, [w, 3.0, 0.02], M.strand, [cx, 1.5, -unitDepth / 2 + 0.01]);
      soft(commonsWall, [w, 0.42, unitDepth], M.timber, [cx, 0.21, 0], { radius: 0.01, puff: 0 });
      soft(commonsWall, [w - 0.04, 0.1, unitDepth - 0.04], M.seat, [cx, 0.47, 0.01], { radius: 0.035, puff: 0.012 });
      soft(commonsWall, [w - 0.1, 0.4, 0.1], M.seat, [cx, 0.74, -unitDepth / 2 + 0.07], { radius: 0.04, puff: 0.015, rotation: [-0.12, 0, 0] });
      const r = w / 2;
      const spandrel = [[cx + r, 3.0], [cx - r, 3.0]];
      for (let i = 0; i <= 40; i++) {
        const t = Math.PI - (i / 40) * Math.PI;
        spandrel.push([cx + Math.cos(t) * r, 2.0 + Math.sin(t) * r * 0.75]);
      }
      mesh(commonsWall, extrudeOut(shapeXY(spandrel), unitDepth), M.timber, [0, 0, -unitDepth / 2]);
      soft(commonsWall, [w - 0.2, 0.3, 0.03], M.acoustic, [cx, 2.82, unitDepth / 2], { radius: 0.01, puff: 0 });
    }
    item(kind === 'shelf' ? 'Display shelving' : 'Arched window seat', commonsWall.children.slice(firstChild));
    ux += w;
  });

  // Oval learning table running into a raised round counter with a tree growing through it.
  const commons = group(root, [-8.6, 0, -3.5]);
  mesh(commons, extrudeUp(roundedShape(rectPoints(2.3, 1.0, -0.55, 0), 0.5), 0.045, 0.012), M.timber, [0, 0.7, 0]);
  for (const x of [-1.2, 0.1]) cylinder(commons, [0.14, 0.18, 0.7, 40], M.darkTimber, [x, 0.35, 0]);
  const counterR = 0.8;
  mesh(commons, extrudeUp(ellipseRing(0.34, 0.34, counterR, counterR), 0.05, 0.014), M.timber, [1.25, 0.95, 0]);
  cylinder(commons, [0.32, 0.36, 0.95, 48], M.timber, [1.25, 0.475, 0]);
  cylinder(commons, [0.3, 0.3, 0.02, 32], std('#3b2c22'), [1.25, 0.99, 0]);
  rod(commons, [1.25, 0.95, 0], [1.3, 2.2, 0.05], 0.06, M.bark);
  for (const [a, b] of [[[1.3, 1.6, 0.04], [0.9, 2.5, -0.2]], [[1.28, 1.9, 0.05], [1.7, 2.6, 0.3]], [[1.3, 2.1, 0.05], [1.2, 2.8, 0.1]]]) rod(commons, a, b, 0.03, M.bark);
  for (let i = 0; i < 14; i++) {
    const r = 0.25 + rand() * 0.25;
    mesh(commons, new THREE.IcosahedronGeometry(r, 3), rand() < 0.5 ? M.foliage : M.foliageDark,
      [1.25 + (rand() - 0.5) * 1.3, 2.35 + rand() * 0.55, (rand() - 0.5) * 1.1]);
  }
  item('Learning table & tree planter', [...commons.children]);
  // Woven ottomans and stools.
  for (const [x, z, h] of [[-1.5, 0.75, 0.42], [-0.6, 0.78, 0.42], [-1.6, -0.72, 0.42], [-0.7, -0.78, 0.42], [-2.0, 0, 0.42], [1.25, 1.12, 0.64], [2.1, 0.3, 0.64], [1.6, -1.05, 0.64]]) {
    mesh(commons, puckGeometry(0.21, h, 0.05, 40), pick(M.woven), [x, 0, z]);
  }
  // Olive perforated rafts and a slim ring pendant over the table.
  for (const [x, z, w, d, tilt] of [[-1.0, -0.2, 1.7, 1.2, 0.05], [0.8, 0.2, 1.4, 1.3, -0.04], [-0.1, -1.4, 1.6, 0.9, 0.03]]) {
    mesh(commons, extrudeUp(roundedShape(rectPoints(w, d), 0.18), 0.05, 0.01), M.acoustic, [x, H - 0.42, z], { rotation: [tilt, 0, tilt], shadow: false });
    for (const [dx, dz] of [[-w / 3, -d / 3], [w / 3, d / 3]]) rod(commons, [x + dx, H - 0.37, z + dz], [x + dx, H, z + dz], 0.003, M.frameDark, { shadow: false });
  }
  const ringPath = new THREE.CurvePath();
  const ringShape = roundedShape(rectPoints(2.4, 1.1, -0.5, 0), 0.45);
  ringShape.getSpacedPoints(160).forEach((p, i, all) => {
    if (i) ringPath.add(new THREE.LineCurve3(new THREE.Vector3(all[i - 1].x, 0, -all[i - 1].y), new THREE.Vector3(p.x, 0, -p.y)));
  });
  mesh(commons, new THREE.TubeGeometry(ringPath, 320, 0.03, 10, true), M.frameDark, [0, 2.55, 0], { shadow: false });
  mesh(commons, new THREE.TubeGeometry(ringPath, 320, 0.016, 8, true), M.led, [0, 2.522, 0], { shadow: false });
  for (const [x, z] of [[-1.5, -0.4], [0.5, 0.4]]) rod(commons, [x, 2.58, z], [x, H, z], 0.003, M.frameDark, { shadow: false });

  // ---------------------------------------------------------------- early-years studio (front)

  const studio = item('Studio storage cabinet', group(root, [0, 0, minZ]));
  const cab = { x0: -4.6, x1: 3.2, depth: 0.5, top: 2.75 };
  const doorBand = (x0, x1, y0, y1) => {
    const n = Math.max(1, Math.round((x1 - x0) / 0.62));
    const dw = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const white = (i + Math.round(y0 * 3)) % 3 !== 0;
      soft(studio, [dw - 0.012, y1 - y0 - 0.012, 0.02], white ? M.lockers : M.timber, [x0 + dw * (i + 0.5), (y0 + y1) / 2, cab.depth - 0.01], { radius: 0.005, puff: 0 });
    }
  };
  // Two navy reading nooks and a slatted media arch let into the cabinetry.
  const arches = [
    { cx: -2.8, w: 1.15, h: 1.75, y0: 0.22, lining: M.nook },
    { cx: -0.3, w: 2.5, h: 1.8, y0: 0.2, lining: M.timber },
    { cx: 2.2, w: 1.15, h: 1.75, y0: 0.22, lining: M.nook },
  ];
  const carcass = new THREE.Shape(shapeXY([[cab.x0, 0], [cab.x1, 0], [cab.x1, cab.top], [cab.x0, cab.top]]).getPoints());
  for (const a of arches) carcass.holes.push(shapeXY(archPoints(a.cx, a.y0, a.w, a.h), new THREE.Path()));
  mesh(studio, extrudeOut(carcass, cab.depth - 0.02, 0.004), M.timber, [0, 0, 0]);
  const studioNooks = new Map();
  for (const a of arches) {
    const nook = item(a.cx === -0.3 ? 'Media arch' : 'Reading nook', group(studio));
    studioNooks.set(a.cx, nook);
    const rim = new THREE.Shape(shapeXY(archPoints(a.cx, a.y0, a.w, a.h)).getPoints());
    rim.holes.push(shapeXY(archPoints(a.cx, a.y0 + 0.03, a.w - 0.06, a.h - 0.06), new THREE.Path()));
    mesh(nook, extrudeOut(rim, cab.depth - 0.04, 0.004), a.lining, [0, 0, 0.01]);
    mesh(nook, extrudeOut(shapeXY(archPoints(a.cx, a.y0, a.w, a.h)), 0.02, 0), a.lining, [0, 0, 0.01]);
  }
  doorBand(cab.x0, cab.x1, 2.05, cab.top);
  for (const [x0, x1] of [[cab.x0, -3.48], [-2.12, -1.66], [1.06, 1.52], [2.88, cab.x1]]) doorBand(x0, x1, 0.12, 2.05);

  soft(studioNooks.get(-2.8), [1.05, 0.12, 0.42], M.nookCushion, [-2.8, 0.31, 0.26], { radius: 0.05, puff: 0.02 });
  for (const dx of [-0.25, 0.22]) soft(studioNooks.get(-2.8), [0.36, 0.3, 0.12], pick([M.nookCushion, M.sofa]), [-2.8 + dx, 0.5, 0.1], { radius: 0.06, puff: 0.03, rotation: [-0.3, dx, 0] });
  for (const y of [0.75, 1.2]) {
    soft(studioNooks.get(2.2), [1.05, 0.025, 0.42], M.timber, [2.2, y, 0.26], { radius: 0.006, puff: 0 });
    books(studioNooks.get(2.2), 1.72, 2.68, y + 0.013, 0.36, 0.24, 0.3, 0.3);
  }
  books(studioNooks.get(2.2), 1.72, 2.68, 0.263, 0.36, 0.24, 0.3, 0.5);
  const media = arches[1];
  for (let x = media.cx - media.w / 2 + 0.05; x < media.cx + media.w / 2 - 0.03; x += 0.07) {
    const dx = Math.abs(x - media.cx);
    const top = media.y0 + media.h - media.w / 2 + Math.sqrt(Math.max(0, (media.w / 2 - 0.03) ** 2 - dx * dx));
    box(studioNooks.get(media.cx), [0.035, top - media.y0 - 0.03, 0.03], M.darkTimber, [x, (top + media.y0) / 2, 0.06]);
  }
  const display = item('Interactive display', group(studio));
  soft(display, [1.5, 0.86, 0.06], M.blackGloss, [media.cx, 1.15, 0.12], { radius: 0.012, puff: 0 });
  box(display, [1.44, 0.8, 0.004], new THREE.MeshStandardMaterial({
    color: '#000000', emissive: '#ffffff', emissiveMap: canvasTexture(1280, 720, drawDisplay), emissiveIntensity: 0.9, roughness: 0.2,
  }), [media.cx, 1.15, 0.152], { shadow: false });

  // Slatted timber baffle ceiling with linear lights over the carpet circle-time space.
  const slats = { x0: -2.1, x1: 1.5, z0: -6.6, z1: -2.9 };
  for (let z = slats.z0; z <= slats.z1; z += 0.16) box(root, [slats.x1 - slats.x0, 0.22, 0.035], M.darkTimber, [(slats.x0 + slats.x1) / 2, H - 0.13, z], { shadow: false });
  for (const s of [slats.x0 - 0.02, slats.x1 + 0.02]) box(root, [0.04, 0.3, slats.z1 - slats.z0 + 0.1], M.darkTimber, [s, H - 0.15, (slats.z0 + slats.z1) / 2], { shadow: false });
  for (const z of [-5.98, -4.70, -3.42]) box(root, [1.6, 0.02, 0.05], M.led, [(slats.x0 + slats.x1) / 2, H - 0.025, z], { shadow: false });
  // Paper lanterns.
  for (const [x, z, y] of [[3.2, -4.5, 2.35], [3.6, -3.9, 2.15]]) {
    mesh(root, new THREE.SphereGeometry(0.2, 32, 20).scale(1, 0.85, 1), M.lantern, [x, y, z], { shadow: false });
    rod(root, [x, y + 0.17, z], [x, H, z], 0.004, M.frameDark, { shadow: false });
  }

  /** Children's chair: beech frame, saddle seat, slatted back. Faces local -z. */
  function kidChair() {
    const c = item("Children's chair", new THREE.Group());
    soft(c, [0.32, 0.025, 0.3], M.kidChair, [0, 0.33, 0], { radius: 0.01, puff: 0 });
    for (const sx of [-0.135, 0.135]) {
      rod(c, [sx, 0, -0.12], [sx, 0.32, -0.12], 0.016, M.kidChair);
      rod(c, [sx, 0, 0.13], [sx, 0.66, 0.16], 0.017, M.kidChair);
      rod(c, [sx, 0.12, -0.12], [sx, 0.12, 0.13], 0.009, M.kidChair);
    }
    soft(c, [0.3, 0.1, 0.02], M.kidChair, [0, 0.6, 0.155], { radius: 0.008, puff: 0, rotation: [0.08, 0, 0] });
    soft(c, [0.3, 0.05, 0.02], M.kidChair, [0, 0.45, 0.145], { radius: 0.008, puff: 0, rotation: [0.08, 0, 0] });
    return c;
  }

  /** Two trapezoid tables pushed together into a hexagon, with a chair at each side. */
  function hexCluster(cx, cz, rotation = 0) {
    const g = group(root, [cx, 0, cz], rotation);
    const trapezoid = (sign) => roundedShape([[-0.6, 0], [0.6, 0], [0.3, sign * 0.52], [-0.3, sign * 0.52]].map(([x, z]) => [x * 0.99, z * 0.99 + sign * 0.004]), 0.03);
    for (const sign of [-1, 1]) {
      const table = item('Trapezoid learning table', group(g));
      mesh(table, extrudeUp(trapezoid(sign), 0.03, 0.008), M.kidChair, [0, 0.53, 0]);
      mesh(table, extrudeUp(trapezoid(sign), 0.004, 0), M.studioTop, [0, 0.561, 0], { shadow: false });
      for (const [x, z] of [[-0.5, 0.05], [0.5, 0.05], [0.25, 0.45], [-0.25, 0.45]]) cylinder(table, [0.024, 0.02, 0.53, 16], M.kidChair, [x, 0.265, sign * z]);
    }
    for (let i = 0; i < 6; i++) {
      const phi = Math.PI / 6 + (i * Math.PI) / 3;
      const r = 0.82 + rand() * 0.06;
      const [x, z] = [Math.cos(phi) * r, Math.sin(phi) * r];
      const chairG = kidChair();
      chairG.position.set(x, 0, z);
      chairG.rotation.y = facing(x, z, 0, 0) + (rand() - 0.5) * 0.25;
      g.add(chairG);
    }
    soft(g, [0.21, 0.016, 0.28], pick(bookColours), [0.1, 0.572, 0.15], { radius: 0.004, puff: 0, rotation: [0, rand(), 0] });
    mesh(g, new THREE.CylinderGeometry(0.04, 0.035, 0.09, 24), pick(bookColours), [-0.2, 0.61, -0.2]);
  }
  hexCluster(-3.0, -3.3, 0.1);
  hexCluster(1.7, -3.3, -0.1);

  // Navy curved sofa in the corner of the studio.
  const sofa = item('Curved sofa', group(root, [3.1, 0, -4.4]));
  const sofaArc = [-0.25 * Math.PI, 0.32 * Math.PI];
  mesh(sofa, extrudeUp(ellipseRing(0.55, 0.55, 1.25, 1.25, ...sofaArc, 48), 0.42, 0.05), M.sofa, [0, 0, 0]);
  mesh(sofa, extrudeUp(ellipseRing(1.1, 1.1, 1.3, 1.3, ...sofaArc, 48), 0.78, 0.06), M.sofa, [0, 0, 0]);
  for (const a of [-0.1, 0.25, 0.6]) {
    const t = sofaArc[0] + a * (sofaArc[1] - sofaArc[0]) + 0.35;
    soft(sofa, [0.5, 0.36, 0.14], M.sofa, [Math.cos(t) * 1.0, 0.6, Math.sin(t) * 1.0], { radius: 0.07, puff: 0.03, rotation: [0, -t + Math.PI / 2, -0.1] });
  }

  // ---------------------------------------------------------------- central reading pit

  const pit = item('Reading pit', group(root, [0.2, 0, 1.4]));
  const entrance = [0.3, Math.PI * 2 - 0.3];
  const ring = { a: 2.6, b: 1.8, t: 0.42 };
  mesh(pit, extrudeUp(ellipseRing(ring.a, ring.b, ring.a + ring.t, ring.b + ring.t, ...entrance, 160), 0.62, 0.02), M.timber, [0, 0, 0]);
  // Vertical battens on the drum's face.
  for (let i = 0; i < 120; i++) {
    const t = entrance[0] + 0.02 + ((i + 0.5) / 120) * (entrance[1] - entrance[0] - 0.04);
    const [x, z] = [Math.cos(t) * (ring.a + ring.t + 0.012), Math.sin(t) * (ring.b + ring.t + 0.012)];
    const tangent = Math.atan2(Math.cos(t) * (ring.b + ring.t), -Math.sin(t) * (ring.a + ring.t));
    box(pit, [0.035, 0.56, 0.02], M.darkTimber, [x, 0.3, z], { rotation: [0, -tangent, 0], shadow: false });
  }
  mesh(pit, extrudeUp(ellipseRing(ring.a - 0.48, ring.b - 0.48, ring.a, ring.b, ...entrance, 160), 0.36, 0.05), M.pit, [0, 0, 0]);
  mesh(pit, extrudeUp(ellipseRing(ring.a - 0.04, ring.b - 0.04, ring.a + 0.02, ring.b + 0.02, ...entrance, 160), 0.6, 0.02), M.pit, [0, 0, 0]);
  mesh(pit, extrudeUp(shapeXZ(ellipsePoints(ring.a - 0.48, ring.b - 0.48)), 0.06, 0.02), M.pit, [0, 0, 0]);
  for (const [x, z, r] of [[-0.9, -0.3, 0.4], [0.6, 0.55, 0.2], [-0.1, 0.7, 1.2], [0.9, -0.5, 2.5], [-1.3, 0.45, 0.9]]) {
    item('Floor cushion', soft(pit, [0.7, 0.14, 0.5], M.floorCushion, [x, 0.13, z], { radius: 0.07, puff: 0.035, rotation: [0, r, 0] }));
  }
  const bookTable = item('Low reading table', group(pit));
  soft(bookTable, [0.6, 0.2, 0.45], M.timber, [0.05, 0.16, -0.05], { radius: 0.02, puff: 0 });
  books(bookTable, -0.2, 0.25, 0.26, 0.2, -0.05, 0.08, 0.4);
  // Drum stools around the outside.
  const stoolSpots = [0.75, 1.15, 1.6, 2.3, 2.75, 3.3, 3.9, 4.4, 4.9, 5.5];
  stoolSpots.forEach((t, i) => {
    const r = 1 + 0.24 / Math.hypot(ring.a, ring.b) + rand() * 0.04;
    item('Drum stool', mesh(root, puckGeometry(0.2, 0.42, 0.04, 40), i % 3 ? M.stools[i % 2] : M.timber,
      [0.2 + Math.cos(t) * (ring.a + ring.t + 0.38) * r, 0, 1.4 + Math.sin(t) * (ring.b + ring.t + 0.38) * r]));
  });
  const pitRug = mesh(root, new THREE.CylinderGeometry(1, 1, 0.012, 128).scale(4.0, 1, 3.15),
    std('#ffffff', { map: canvasTexture(512, 512, drawRingRug('#e8dccb', '#d2c0a6')), roughness: 1, bumpMap: fabricBump, bumpScale: 1.2 }),
    [0.2, 0.008, 1.4], { shadow: false });
  pitRug.userData.floor = true;

  // Oval timber coffer with a cove light and a cluster chandelier.
  const cofferHole = { a: 2.9, b: 2.0 };
  const coffer = new THREE.Shape(shapeXZ(rectPoints(6.6, 5.6)).getPoints());
  coffer.holes.push(shapeXZ(ellipsePoints(cofferHole.a, cofferHole.b, 0, Math.PI * 2, 128), new THREE.Path()));
  mesh(root, extrudeUp(coffer, 0.3, 0), M.ceiling, [0.2, H - 0.3, 1.4], { shadow: false });
  const cove = new THREE.EllipseCurve(0, 0, cofferHole.a + 0.03, cofferHole.b + 0.03);
  const covePath = new THREE.CatmullRomCurve3(cove.getPoints(160).map((p) => new THREE.Vector3(p.x, 0, p.y)), true);
  mesh(root, new THREE.TubeGeometry(covePath, 320, 0.018, 8, true), M.led, [0.2, H - 0.31, 1.4], { shadow: false });
  for (let x = -cofferHole.a + 0.2; x < cofferHole.a - 0.1; x += 0.28) {
    const half = cofferHole.b * Math.sqrt(1 - (x / cofferHole.a) ** 2);
    box(root, [0.06, 0.18, half * 2], M.timber, [0.2 + x, H - 0.09, 1.4], { shadow: false });
  }
  for (let i = 0; i < 42; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    const [x, z] = [0.2 + Math.cos(a) * r * 1.6, 1.4 + Math.sin(a) * r * 1.05];
    const y = 2.55 + rand() * 0.6;
    mesh(root, new THREE.SphereGeometry(0.05 + rand() * 0.035, 20, 14), M.chandelier, [x, y, z], { shadow: false });
    rod(root, [x, y, z], [x, H, z], 0.002, M.frameDark, { shadow: false });
  }

  // ---------------------------------------------------------------- library (back, by the garden)

  const library = group(root, [0, 0, maxZ - 0.2], Math.PI);
  // Local frame faces +z after the half turn, so x runs mirrored: world x = -local x.
  const lib = { x0: 3.6, x1: 10.85, top: 2.3, depth: 0.4 };
  box(library, [lib.x1 - lib.x0, 0.65, lib.depth], M.timber, [(lib.x0 + lib.x1) / 2, lib.top + 0.35, 0]);
  for (let x = lib.x0; x < lib.x1 - 0.01; x += 0.6) soft(library, [0.585, 0.6, 0.02], M.timber, [x + 0.3, lib.top + 0.35, lib.depth / 2 + 0.01], { radius: 0.004, puff: 0 });
  const podRound = { cx: 8.6, cy: 1.15, r: 0.78 };
  const podArch = { cx: 6.0, w: 1.4, h: 1.95, y0: 0.18 };
  shelving(library, lib.x0, 5.15, 0.05, lib.top, lib.depth, 6, { sparse: 0.12 });
  shelving(library, 6.85, 7.7, 0.05, lib.top, lib.depth, 6, { sparse: 0.12 });
  shelving(library, 9.5, lib.x1, 0.05, lib.top, lib.depth, 6, { sparse: 0.12 });
  // Felt panel behind each pod with the opening cut through.
  const podPanel = (x0, x1, hole) => {
    const s = new THREE.Shape(shapeXY([[x0, 0], [x1, 0], [x1, lib.top], [x0, lib.top]]).getPoints());
    s.holes.push(shapeXY(hole, new THREE.Path()));
    mesh(library, extrudeOut(s, 0.05), std('#9ea3a1', { roughness: 1, bumpMap: fabricBump, bumpScale: 1 }), [0, 0, lib.depth / 2 - 0.05]);
  };
  podPanel(5.15, 6.85, archPoints(podArch.cx, podArch.y0, podArch.w, podArch.h));
  podPanel(7.7, 9.5, circlePoints(podRound.cx, podRound.cy, podRound.r));
  // Round pod: thick rim, padded interior.
  const roundPodStart = library.children.length;
  const roundRim = new THREE.Shape(shapeXY(circlePoints(podRound.cx, podRound.cy, podRound.r + 0.06)).getPoints());
  roundRim.holes.push(shapeXY(circlePoints(podRound.cx, podRound.cy, podRound.r - 0.06), new THREE.Path()));
  mesh(library, extrudeOut(roundRim, 0.62, 0.03), M.pods[0], [0, 0, -0.32]);
  mesh(library, extrudeOut(shapeXY(circlePoints(podRound.cx, podRound.cy, podRound.r - 0.05)), 0.06, 0.03), M.podInner[0], [0, 0, -0.3]);
  soft(library, [1.1, 0.14, 0.5], M.podInner[0], [podRound.cx, podRound.cy - podRound.r + 0.22, 0.0], { radius: 0.06, puff: 0.03 });
  for (let i = 0; i < 3; i++) {
    const t = -Math.PI / 2 + (i - 1) * 0.9;
    soft(library, [0.5, 0.45, 0.08], M.podInner[0], [podRound.cx + Math.cos(t) * 0.42, podRound.cy + Math.sin(t) * 0.42 + 0.55, -0.22], { radius: 0.08, puff: 0.04, rotation: [0, 0, t + Math.PI / 2] });
  }
  // Arched pod.
  item('Round library pod', library.children.slice(roundPodStart));
  const archPodStart = library.children.length;
  const archRim = new THREE.Shape(shapeXY(archPoints(podArch.cx, podArch.y0 - 0.06, podArch.w + 0.12, podArch.h + 0.12)).getPoints());
  archRim.holes.push(shapeXY(archPoints(podArch.cx, podArch.y0 + 0.06, podArch.w - 0.12, podArch.h - 0.12), new THREE.Path()));
  mesh(library, extrudeOut(archRim, 0.62, 0.03), M.pods[1], [0, 0, -0.32]);
  mesh(library, extrudeOut(shapeXY(archPoints(podArch.cx, podArch.y0, podArch.w - 0.1, podArch.h - 0.1)), 0.06, 0.03), M.podInner[1], [0, 0, -0.3]);
  soft(library, [podArch.w - 0.14, 0.16, 0.52], M.podInner[1], [podArch.cx, podArch.y0 + 0.14, 0.0], { radius: 0.06, puff: 0.03 });
  for (const dx of [-0.3, 0.3]) soft(library, [0.5, 0.7, 0.1], M.podInner[1], [podArch.cx + dx, podArch.y0 + 0.7, -0.24], { radius: 0.09, puff: 0.04 });
  item('Arched library pod', library.children.slice(archPodStart));

  // Two curved benches – timber shell, upholstered seat and back – opening towards the shelves.
  function curvedBench(cx, cz, from, to) {
    const g = item('Curved library bench', group(root, [cx, 0, cz]));
    mesh(g, extrudeUp(ellipseRing(1.5, 1.5, 2.05, 2.05, from, to, 80), 0.4, 0.015), M.timber, [0, 0, 0]);
    mesh(g, extrudeUp(ellipseRing(1.54, 1.54, 1.9, 1.9, from + 0.01, to - 0.01, 80), 0.09, 0.03), M.bench, [0, 0.38, 0]);
    mesh(g, extrudeUp(ellipseRing(1.9, 1.9, 2.05, 2.05, from, to, 80), 0.42, 0.04), M.bench, [0, 0.42, 0]);
    mesh(g, extrudeUp(ellipseRing(1.88, 1.88, 2.12, 2.12, from - 0.015, to + 0.015, 80), 0.04, 0.012), M.timber, [0, 0.84, 0]);
    // Back panels split into upholstered bays.
    for (let i = 1; i < 6; i++) {
      const t = from + ((to - from) * i) / 6;
      box(g, [0.13, 0.4, 0.012], M.timber, [Math.cos(t) * 1.97, 0.63, Math.sin(t) * 1.97], { rotation: [0, -t, 0], shadow: false });
    }
    for (let i = 0; i < 6; i++) {
      const t = from + ((to - from) * (i + 0.5)) / 6;
      books(group(g, [Math.cos(t) * 1.5, 0, Math.sin(t) * 1.5], -t - Math.PI / 2), -0.2, 0.2, 0.06, 0.2, -0.06, 0.26, 0.3);
    }
  }
  curvedBench(-8.7, 4.4, 0.85 * Math.PI, 1.62 * Math.PI);
  curvedBench(-5.0, 4.4, 1.38 * Math.PI, 2.15 * Math.PI);
  const libRug = mesh(root, new THREE.CylinderGeometry(1.55, 1.55, 0.012, 96),
    std('#ffffff', { map: canvasTexture(512, 512, drawRingRug('#a9aeb0', '#8f9597')), roughness: 1, bumpMap: fabricBump, bumpScale: 1.5 }),
    [-6.9, 0.008, 4.7], { shadow: false });
  libRug.userData.floor = true;
  for (const [x, z, i] of [[-7.4, 5.2, 0], [-6.4, 5.4, 1], [-5.2, 6.0, 2]]) mesh(root, beanGeometry(rand), M.beans[i], [x, 0.01, z], { rotation: [0, rand() * 3, 0] });
  for (const [x, z, i] of [[-6.9, 4.3, 0], [-7.9, 4.2, 1], [-6.0, 4.6, 2], [-9.6, 2.0, 1]]) mesh(root, pebbleGeometry(), M.pebbles[i], [x, 0.01, z], { rotation: [0, rand() * 3, 0] });
  mesh(root, puckGeometry(0.2, 0.42, 0.04, 40), M.stools[0], [-7.1, 0.012, 3.5]);

  // Wavy drop ceiling with a glowing cove edge, echoing the oak floor below.
  const libCeiling = shapeXZ([[-11.2, 7.2], [-3.0, 7.2], ...libraryEdge, [-11.2, libraryWave(-11)]]);
  mesh(root, extrudeUp(libCeiling, 0.28, 0), M.ceiling, [0, H - 0.28, 0], { shadow: false });
  const wavePath = new THREE.CatmullRomCurve3(libraryEdge.map(([x, z]) => new THREE.Vector3(x, 0, z - 0.03)));
  mesh(root, new THREE.TubeGeometry(wavePath, 240, 0.016, 8, false), M.led, [0, H - 0.29, 0], { shadow: false });
  for (const [x, z] of [[-9.8, 3.6], [-7.6, 3.4], [-5.4, 3.6], [-9.0, 5.6], [-6.6, 5.6], [-4.2, 5.6]]) downlight(x, z, H - 0.28);

  // ---------------------------------------------------------------- lockers (back wall)

  const lockers = item('Locker storage & bench', group(root, [0, 0, maxZ - 0.23], Math.PI));
  const lk = { x0: -3.8, x1: 1.6, depth: 0.45 };
  const lw = lk.x1 - lk.x0;
  const lcx = (lk.x0 + lk.x1) / 2;
  box(lockers, [lw, 0.42, lk.depth], M.timber, [lcx, 0.21, 0]);
  const cols = 12;
  for (let i = 0; i <= cols; i++) box(lockers, [0.02, 0.38, lk.depth], M.timber, [lk.x0 + (lw * i) / cols, 0.21, 0.01]);
  for (let i = 0; i < cols; i++) {
    const cx = lk.x0 + (lw * (i + 0.5)) / cols;
    box(lockers, [lw / cols - 0.03, 0.36, 0.01], M.darkTimber, [cx, 0.21, -lk.depth / 2 + 0.01]);
    if (rand() < 0.7) soft(lockers, [0.3, 0.26, 0.2], pick(bagColours), [cx, 0.17, 0.04], { radius: 0.06, puff: 0.03 });
  }
  soft(lockers, [lw, 0.03, lk.depth + 0.02], M.timber, [lcx, 0.435, 0.01], { radius: 0.01, puff: 0 });
  soft(lockers, [lw - 0.04, 0.07, lk.depth - 0.04], M.sofa, [lcx, 0.485, 0.02], { radius: 0.03, puff: 0.01 });
  box(lockers, [lw, 0.75, 0.02], M.lockers, [lcx, 0.9, -lk.depth / 2 + 0.01]);
  for (let i = 0; i < 9; i++) {
    const x = lk.x0 + 0.3 + i * 0.6;
    rod(lockers, [x, 1.05, -0.2], [x, 1.05, -0.13], 0.008, M.aluminium);
  }
  box(lockers, [lw, 1.3, 0.38], M.timber, [lcx, 1.95, -0.035]);
  for (let i = 0; i < 9; i++) {
    for (const [y, h] of [[1.62, 0.62], [2.26, 0.62]]) {
      const x = lk.x0 + 0.3 + i * 0.6;
      soft(lockers, [0.585, h - 0.015, 0.02], M.lockers, [x, y, 0.165], { radius: 0.005, puff: 0 });
      box(lockers, [0.012, 0.1, 0.012], M.frameDark, [x + 0.24, y - 0.08, 0.18], { shadow: false });
    }
  }

  // ---------------------------------------------------------------- dining commons (back right)

  // Terracotta slatted feature wall.
  for (let x = 4.0; x < 9.9; x += 0.09) box(root, [0.055, H - 0.4, 0.06], M.slats, [x, (H - 0.4) / 2, maxZ - 0.03]);
  // Green tiered seating against timber-clad wall.
  for (let z = 1.0; z < 6.9; z += 0.15) box(root, [0.04, 2.6, 0.12], M.timber, [maxX - 0.02, 1.3, z]);
  const tiers = item('Tiered seating', group(root, [maxX - 0.6, 0, 3.9]));
  soft(tiers, [0.55, 0.42, 5.6], M.timber, [-0.27, 0.21, 0], { radius: 0.02, puff: 0, step: 0.2 });
  soft(tiers, [0.55, 0.82, 5.6], M.timber, [0.3, 0.41, 0], { radius: 0.02, puff: 0, step: 0.2 });
  soft(tiers, [0.53, 0.08, 5.55], M.tiers, [-0.27, 0.46, 0], { radius: 0.03, puff: 0.01, step: 0.2 });
  soft(tiers, [0.53, 0.08, 5.55], M.tiers, [0.3, 0.86, 0], { radius: 0.03, puff: 0.01, step: 0.2 });

  // Serpentine white counter with a green inlay, bentwood stools both sides.
  const counterPath = new THREE.CatmullRomCurve3([[5.5, 6.3], [6.6, 5.1], [7.9, 4.7], [8.5, 3.1], [8.0, 1.4]].map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const ribbon = (width, from = 0, to = 1, steps = 140) => {
    const left = [];
    const right = [];
    for (let i = 0; i <= steps; i++) {
      const u = from + ((to - from) * i) / steps;
      const p = counterPath.getPointAt(u);
      const t = counterPath.getTangentAt(u);
      left.push([p.x - t.z * width / 2, p.z + t.x * width / 2]);
      right.push([p.x + t.z * width / 2, p.z - t.x * width / 2]);
    }
    return shapeXZ([...left, ...right.reverse()]);
  };
  const counterStart = root.children.length;
  mesh(root, extrudeUp(ribbon(0.82), 0.05, 0.015, 4), M.counter, [0, 0.72, 0]);
  mesh(root, extrudeUp(ribbon(0.5, 0.015, 0.985), 0.72, 0.01, 4), M.counter, [0, 0, 0]);
  for (const [a, b] of [[0.06, 0.42], [0.55, 0.94]]) mesh(root, extrudeUp(ribbon(0.06, a, b), 0.002, 0, 4), M.inlay, [0, 0.771, 0], { shadow: false });
  item('Dining counter', root.children.slice(counterStart));
  const length = counterPath.getLength();
  for (let s = 0.35; s < length - 0.2; s += 0.62) {
    const u = s / length;
    const p = counterPath.getPointAt(u);
    const t = counterPath.getTangentAt(u);
    for (const side of [-1, 1]) {
      const [x, z] = [p.x - t.z * side * 0.62, p.z + t.x * side * 0.62];
      const stool = item('Bentwood stool', group(root, [x, 0, z], rand() * Math.PI));
      mesh(stool, puckGeometry(0.17, 0.035, 0.012, 40), M.timber, [0, 0.44, 0]);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        rod(stool, [Math.cos(a) * 0.13, 0.44, Math.sin(a) * 0.13], [Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15], 0.016, M.timber);
      }
      mesh(stool, new THREE.TorusGeometry(0.14, 0.008, 8, 40).rotateX(Math.PI / 2), M.timber, [0, 0.2, 0]);
    }
  }
  // Floating round rafts with moss centres and glowing rims.
  for (const [x, z, r] of [[6.4, 3.5, 1.15], [9.0, 5.4, 1.05], [9.3, 2.5, 0.95], [6.2, 6.0, 0.8]]) {
    const y = H - 0.5;
    mesh(root, extrudeUp(ellipseRing(r * 0.42, r * 0.42, r, r, 0, Math.PI * 2, 96), 0.12, 0.03), M.ceiling, [x, y, z], { shadow: false });
    mesh(root, puckGeometry(r * 0.42, 0.14, 0.03, 48), M.moss, [x, y + 0.02, z], { shadow: false });
    mesh(root, new THREE.TorusGeometry(r * 0.43, 0.014, 8, 96).rotateX(Math.PI / 2), M.led, [x, y - 0.005, z], { shadow: false });
    mesh(root, new THREE.TorusGeometry(r + 0.004, 0.01, 8, 96).rotateX(Math.PI / 2), M.led, [x, y + 0.06, z], { shadow: false });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      rod(root, [x + Math.cos(a) * r * 0.7, y + 0.12, z + Math.sin(a) * r * 0.7], [x + Math.cos(a) * r * 0.7, H, z + Math.sin(a) * r * 0.7], 0.003, M.frameDark, { shadow: false });
    }
  }

  // ---------------------------------------------------------------- movement room (front right)

  // Rolling timber hills along the walls.
  const hills = (length, phase) => {
    const pts = [[0, 0], [length, 0]];
    for (let i = 0; i <= 120; i++) {
      const s = length * (1 - i / 120);
      pts.push([s, 1.0 + 0.28 * Math.sin(s * 1.3 + phase) + 0.14 * Math.sin(s * 3.1 + phase * 2)]);
    }
    return shapeXY(pts);
  };
  mesh(root, extrudeOut(hills(maxX - 4.95, 0.4), 0.03), M.timber, [4.95, 0, minZ]);
  mesh(root, extrudeOut(hills(-1.25 - minZ, 2.1), 0.03), M.timber, [maxX, 0, minZ], { rotation: [0, -Math.PI / 2, 0] });

  // Timber playhouse frame.
  const house = item('Timber playhouse', group(root, [9.5, 0.002, -5.6], -0.3));
  const [hw, hd, wallH, ridge] = [1.4, 1.2, 1.25, 1.95];
  soft(house, [hw + 0.1, 0.08, hd + 0.1], M.timber, [0, 0.04, 0], { radius: 0.015, puff: 0 });
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(house, [0.07, wallH, 0.07], M.timber, [(x * hw) / 2, 0.08 + wallH / 2, (z * hd) / 2]);
  for (const z of [-hd / 2, hd / 2]) {
    rod(house, [-hw / 2 - 0.08, wallH - 0.02, z], [0, ridge, z], 0.035, M.timber);
    rod(house, [hw / 2 + 0.08, wallH - 0.02, z], [0, ridge, z], 0.035, M.timber);
  }
  box(house, [0.06, 0.06, hd + 0.2], M.timber, [0, ridge, 0]);
  const pitch = Math.atan2(ridge - wallH, hw / 2);
  for (const s of [-1, 1]) {
    for (let z = -hd / 2 - 0.05; z <= hd / 2 + 0.06; z += 0.14) {
      box(house, [Math.hypot(hw / 2, ridge - wallH) + 0.12, 0.025, 0.08], M.timber, [(s * hw) / 4, (wallH + ridge) / 2 + 0.03, z], { rotation: [0, 0, -s * pitch] });
    }
  }
  for (const [axis, len, pos] of [['x', hw, [0, 0, hd / 2]], ['z', hd, [-hw / 2, 0, 0]]]) {
    const rail = axis === 'x' ? [len, 0.05, 0.05] : [0.05, 0.05, len];
    box(house, rail, M.timber, [pos[0], 0.62, pos[2]]);
    for (let s = -len / 2 + 0.12; s < len / 2 - 0.08; s += 0.12) {
      box(house, [0.035, 0.52, 0.035], M.timber, axis === 'x' ? [s, 0.35, pos[2]] : [pos[0], 0.35, s]);
    }
  }
  mesh(house, pebbleGeometry(), M.pebbles[2], [0.1, 0.08, -0.1]);

  // Soft-play rings around a pouf, on a traditional rug.
  const rug = mesh(root, new THREE.BoxGeometry(3.2, 0.012, 2.2),
    std('#ffffff', { map: canvasTexture(1024, 704, drawRug(rand)), roughness: 1, bumpMap: fabricBump, bumpScale: 1.2 }), [7.4, 0.008, -3.7], { shadow: false });
  rug.userData.floor = true;
  mesh(root, extrudeUp(ellipseRing(0.42, 0.42, 0.85, 0.85, 0.5, Math.PI * 2 - 0.5, 72), 0.36, 0.08), M.rings[0], [7.0, 0.014, -3.3], { rotation: [0, 0.6, 0] });
  mesh(root, extrudeUp(ellipseRing(0.32, 0.32, 0.65, 0.65, 0.6, Math.PI * 2 - 0.6, 72), 0.3, 0.07), M.rings[1], [7.9, 0.014, -4.1], { rotation: [0, 2.8, 0] });
  mesh(root, puckGeometry(0.3, 0.32, 0.06), M.stools[1], [7.9, 0.014, -4.1]);
  for (const [x, z, r] of [[6.1, -2.3, 0.33], [9.1, -2.4, 0.3], [10.2, -3.6, 0.33]]) mesh(root, new THREE.SphereGeometry(r, 48, 32), M.ballBlue, [x, r, z]);
  const stones = ['#e9c13f', '#7cc576', '#e8705f', '#4aa3df'];
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    mesh(root, puckGeometry(0.13, 0.03, 0.012, 32), std(stones[i % 4], { roughness: 0.6 }),
      [5.4 + Math.sin(t * Math.PI * 1.5) * 0.35 + t * 0.4, 0.002, -6.3 + t * 3.0]);
  }

  // Circular raised ceiling with a cove glow over the movement room.
  const moveCeiling = new THREE.Shape(shapeXZ(rectPoints(maxX - 4.9 + 0.2, -1.0 - minZ + 0.2, (maxX + 4.9) / 2, (minZ - 1.0) / 2)).getPoints());
  moveCeiling.holes.push(shapeXZ(ellipsePoints(2.6, 2.6, 0, Math.PI * 2, 128, 7.9, -3.9), new THREE.Path()));
  mesh(root, extrudeUp(moveCeiling, 0.22, 0), M.ceiling, [0, H - 0.22, 0], { shadow: false });
  mesh(root, new THREE.TorusGeometry(2.62, 0.016, 8, 200).rotateX(Math.PI / 2), M.led, [7.9, H - 0.23, -3.9], { shadow: false });
  for (const [x, z] of [[7.9, -3.9], [6.6, -2.6], [9.2, -2.6], [6.6, -5.2], [9.2, -5.2]]) downlight(x, z);

  // ---------------------------------------------------------------- plants

  function fiddleLeaf(scale) {
    const p = new THREE.Group();
    const potProfile = [[0, 0], [0.2, 0], [0.24, 0.5], [0.22, 0.5], [0.2, 0.06], [0, 0.06]].map(([x, y]) => new THREE.Vector2(x, y));
    mesh(p, new THREE.LatheGeometry(potProfile, 48), M.potWhite, [0, 0, 0]);
    cylinder(p, [0.21, 0.21, 0.02, 32], std('#3b2c22'), [0, 0.46, 0]);
    const leafGeometry = new THREE.CircleGeometry(0.12, 24).scale(0.75, 1.3, 1).translate(0, 0.14, 0);
    for (let s = 0; s < 3; s++) {
      const angle = (s / 3) * Math.PI * 2 + rand();
      const top = [Math.cos(angle) * 0.18, 1.3 + rand() * 0.4, Math.sin(angle) * 0.18];
      rod(p, [0, 0.46, 0], top, 0.012, M.bark);
      for (let l = 0; l < 10; l++) {
        const t = 0.3 + (l / 10) * 0.75;
        const leafMesh = new THREE.Mesh(leafGeometry, M.leaf);
        const a = angle + rand() * Math.PI * 2;
        leafMesh.position.set(top[0] * t + Math.cos(a) * 0.05, 0.46 + (top[1] - 0.46) * t, top[2] * t + Math.sin(a) * 0.05);
        leafMesh.rotation.set(-0.5 - rand() * 0.6, a, (rand() - 0.5) * 0.6, 'YXZ');
        leafMesh.castShadow = true;
        p.add(leafMesh);
      }
    }
    p.scale.setScalar(scale);
    return p;
  }
  for (const [x, z, s] of [[-10.5, 1.0, 1.0], [-5.08, -6.6, 0.9], [4.2, 6.5, 1.0], [10.5, 0.8, 0.9], [-4.2, -0.4, 0.85]]) {
    const plant = fiddleLeaf(s);
    plant.position.set(x, 0, z);
    root.add(plant);
  }

  // ---------------------------------------------------------------- garden outside

  mesh(root, new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), M.grass, [0, -0.12, 0], { shadow: false }).userData.noPick = true;
  box(root, [3.0, 0.1, 40], M.paving, [minX - 1.8, -0.08, 0], { shadow: false }).userData.noPick = true;
  function tree(scale) {
    const t = new THREE.Group();
    cylinder(t, [0.09, 0.16, 2.6, 16], M.bark, [0, 1.3, 0]);
    for (let i = 0; i < 7; i++) {
      const r = 0.9 + rand() * 0.7;
      mesh(t, new THREE.IcosahedronGeometry(r, 3), rand() < 0.5 ? M.foliage : M.foliageDark, [(rand() - 0.5) * 1.8, 3.0 + rand() * 1.6, (rand() - 0.5) * 1.8]);
    }
    t.scale.setScalar(scale);
    t.traverse((o) => { o.userData.noPick = true; });
    return t;
  }
  // Kept out of the sun's path so its light still reaches the floor inside.
  for (const [x, z, s] of [[-14, 9.5, 1.1], [-16, 13, 1.3], [-24, -4, 1.6], [-27, 4, 1.5], [-26, -12, 1.7], [-32, 8, 1.8], [-13, -21, 1.3]]) {
    const t = tree(s);
    t.position.set(x, -0.12, z);
    root.add(t);
  }
  for (let z = -16; z <= 16; z += 1.4) {
    const shrub = mesh(root, new THREE.IcosahedronGeometry(0.55 + rand() * 0.25, 2), rand() < 0.5 ? M.foliage : M.foliageDark, [minX - 3.6 + rand() * 0.3, 0.2, z]);
    shrub.scale.y = 0.7;
    shrub.userData.noPick = true;
  }
  for (const [x, z, sx, sy, sz] of [[-180, -120, 120, 26, 80], [-220, 60, 160, 34, 90], [-160, 200, 110, 22, 70]]) {
    const hill = mesh(root, new THREE.SphereGeometry(1, 48, 24), std('#7d9a6a', { roughness: 1 }), [x, -0.5, z], { shadow: false });
    hill.scale.set(sx, sy, sz);
    hill.userData.noPick = true;
  }

  // ---------------------------------------------------------------- configurable sets

  const sets = [
    { id: 'timber', label: 'Timber joinery', options: OPTIONS.timber, materials: [M.timber] },
    { id: 'column', label: 'Columns', options: OPTIONS.column, materials: [M.column] },
    { id: 'pit', label: 'Reading pit', options: OPTIONS.pit, materials: [M.pit] },
    { id: 'floorCushion', label: 'Floor cushions', options: OPTIONS.floorCushion, materials: [M.floorCushion] },
    { id: 'kidChair', label: "Children's chairs & tables", options: OPTIONS.kidChair, materials: [M.kidChair] },
    { id: 'studioTop', label: 'Table tops', options: OPTIONS.studioTop, materials: [M.studioTop] },
    { id: 'nook', label: 'Reading nooks', options: OPTIONS.nook, materials: [M.nook] },
    { id: 'pod', label: 'Library pod', options: OPTIONS.pod, materials: M.pods, each: true },
    { id: 'bench', label: 'Library benches', options: OPTIONS.bench, materials: [M.bench] },
    { id: 'bean', label: 'Bean bag', options: OPTIONS.bean, materials: M.beans, each: true },
    { id: 'pebble', label: 'Pebble cushion', options: OPTIONS.pebble, materials: M.pebbles, each: true },
    { id: 'stool', label: 'Drum stools', options: OPTIONS.stool, materials: M.stools, each: true },
    { id: 'seat', label: 'Window seats', options: OPTIONS.seat, materials: [M.seat] },
    { id: 'woven', label: 'Woven ottoman', options: OPTIONS.woven, materials: M.woven, each: true },
    { id: 'sofa', label: 'Sofa & locker bench', options: OPTIONS.sofa, materials: [M.sofa] },
    { id: 'rings', label: 'Soft-play ring', options: OPTIONS.rings, materials: M.rings, each: true },
    { id: 'tiers', label: 'Tiered seating', options: OPTIONS.tiers, materials: [M.tiers] },
    { id: 'counter', label: 'Dining counter', options: OPTIONS.counter, materials: [M.counter] },
    { id: 'inlay', label: 'Counter inlay', options: OPTIONS.inlay, materials: [M.inlay] },
    { id: 'acoustic', label: 'Acoustic panels', options: OPTIONS.acoustic, materials: [M.acoustic] },
    { id: 'lockers', label: 'Cabinet doors', options: OPTIONS.lockers, materials: [M.lockers] },
    { id: 'slats', label: 'Feature slats', options: OPTIONS.slats, materials: [M.slats] },
    { id: 'walls', label: 'Walls', options: OPTIONS.walls, materials: [M.wall] },
  ];
  const originalSets = new Map(sets.flatMap((set) => set.materials.map((material) => [material, set])));
  // Standalone upholstered pieces and panels are already complete objects. Architecture keeps its palette.
  root.traverse((object) => {
    if (!object.isMesh || !originalSets.has(object.material)) return;
    let owner = object;
    while (owner && !owner.userData.itemId) owner = owner.parent;
    if (!owner && ![M.timber, M.column, M.wall, M.slats].includes(object.material)) {
      item(originalSets.get(object.material).label.replace(/s$/, ''), object);
    }
  });
  mergeStatic(root);
  const items = new Map();
  const itemMaterials = new Map();
  const itemSets = new Map();
  const configuredMaterials = new Map();
  root.traverse((object) => {
    if (!object.isMesh) return;
    const id = object.userData.itemId;
    const source = object.material;
    let set = originalSets.get(source);
    if (id) {
      if (!items.has(id)) items.set(id, { id, label: itemLabels.get(id), meshes: [] });
      items.get(id).meshes.push(object);
      if (set) {
        const materialKey = `${id}|${source.uuid}`;
        if (!itemMaterials.has(materialKey)) itemMaterials.set(materialKey, source.clone());
        object.material = itemMaterials.get(materialKey);
        const setKey = `${id}|${set.id}`;
        if (!itemSets.has(setKey)) itemSets.set(setKey, { ...set, materials: [] });
        set = itemSets.get(setKey);
        if (!set.materials.includes(object.material)) set.materials.push(object.material);
      }
    }
    if (set) configuredMaterials.set(object.material, set);
  });
  // Assign configuration after cloning, so material copies never serialize a circular set.
  for (const [material, set] of configuredMaterials) {
    const hex = `#${material.color.getHexString()}`;
    const index = set.options.findIndex((option) => option.color.toLowerCase() === hex);
    material.userData.configurable = { set, option: Math.max(0, index) };
  }
  root.add(lights);
  return { group: root, items, update() {} };
}
