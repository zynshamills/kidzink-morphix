import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { buildCommons, ROOM, SUN_DIRECTION } from './commons';
import { createItemInspection } from './inspection';

const EYE_HEIGHT = 1.5; // metres
const WALL_MARGIN = 0.45; // closest the camera may stop to a wall
const LOOK_SPEED = 0.0032; // radians per pixel dragged
const DRAG_THRESHOLD = 5; // pixels before a press counts as a drag instead of a click
const MIN_FOV = 35;
const MAX_FOV = 70;

// Camera hovers here behind the landing screen, then glides down to the start point on "Enter".
const INTRO = { position: new THREE.Vector3(9.4, 3.0, -0.6), lookAt: new THREE.Vector3(-4, 0.6, 2.6) };
const START = { position: new THREE.Vector3(7.2, EYE_HEIGHT, -0.3), lookAt: new THREE.Vector3(-4, 0.9, 2.4) };

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Yaw/pitch for a camera at `from` looking at `to` (rotation order YXZ, yaw 0 = looking down -z). */
function anglesTo(from, to) {
  const d = new THREE.Vector3().subVectors(to, from);
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
}

/** Shortest signed difference between two angles. */
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/**
 * Creates the learning commons on a canvas.
 * Callbacks:
 *   onSelect({ label, options, active } | null) – material palette for the clicked object
 *   onInteract('look' | 'move' | 'material')    – used to advance the on-screen hints
 * Returns the viewer API plus `ready`, a promise that resolves once shaders are compiled.
 */
export function createViewer(canvas, { onSelect, onInteract, onInspect } = {}) {
  // -------------------------------------------------------------- renderer / scene

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // Render at full-HD or better: at least 1080 device pixels tall, up to 2x on high-density screens.
  // '?scale=1' forces native resolution (handy on slow GPUs).
  const forcedScale = Number(new URLSearchParams(window.location.search).get('scale')) || 0;
  const pixelRatio = () => forcedScale || THREE.MathUtils.clamp(Math.max(window.devicePixelRatio, 1080 / Math.max(1, canvas.clientHeight)), 1, 2);
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // soft in r186+, blurred by shadow.radius
  // Nothing in the room moves, so the sun's shadow map is rendered once instead of every frame.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc4d6e4, 400, 6000); // haze towards the horizon

  // Physical sky seen through the glass.
  const sky = new Sky();
  sky.scale.setScalar(4500);
  const skyUniforms = sky.material.uniforms;
  skyUniforms.turbidity.value = 2.5;
  skyUniforms.rayleigh.value = 1.2;
  skyUniforms.mieCoefficient.value = 0.004;
  skyUniforms.mieDirectionalG.value = 0.8;
  skyUniforms.sunPosition.value.copy(SUN_DIRECTION);
  scene.add(sky);

  // Neutral studio environment for reflections and fill: a sky-based one tints the whole interior blue.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.45;

  const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.05, 6000);
  camera.rotation.order = 'YXZ';

  // Soft bounce light from the bright floor and sky, standing in for baked global illumination.
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0xe8d6bc, 1.0));

  // Morning sun over the garden, raking in through the windows.
  const sun = new THREE.DirectionalLight(0xfff0da, 4.5);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 90 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);

  const space = buildCommons();
  scene.add(space.group);

  // Ambient occlusion gives the soft, "baked" contact shadows of an architectural render.
  // A multisampled HDR target keeps edges clean through the post-processing chain.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, canvas.clientWidth, canvas.clientHeight);
  ao.updateGtaoMaterial({ radius: 0.4, distanceExponent: 1.5, thickness: 1, scale: 1 });
  ao.blendIntensity = 0.9;
  composer.addPass(ao);
  // Only the LED coves, lanterns and chandelier are bright enough to bloom.
  const bloom = new UnrealBloomPass(new THREE.Vector2(canvas.clientWidth, canvas.clientHeight), 0.35, 0.5, 2.2);
  composer.addPass(bloom);
  const outline = new OutlinePass(new THREE.Vector2(canvas.clientWidth, canvas.clientHeight), scene, camera);
  outline.visibleEdgeColor.set('#e43d2f');
  outline.hiddenEdgeColor.set('#000000');
  outline.edgeStrength = 1.7;
  outline.edgeThickness = 1;
  outline.enabled = false;
  composer.addPass(outline);
  composer.addPass(new OutputPass());
  const inspection = createItemInspection(canvas, camera, ROOM, (item) => {
    outline.selectedObjects = item ? space.items.get(item.id).meshes : [];
    outline.enabled = !!item;
    onInspect?.(item);
  });

  // -------------------------------------------------------------- configurable materials

  const configurable = [];
  space.group.traverse((o) => {
    if (!o.isMesh) return;
    const config = o.material.userData.configurable;
    if (config && !configurable.includes(o.material)) {
      o.material.emissive.set(0xffffff);
      o.material.emissiveIntensity = 0;
      configurable.push(o.material);
    }
  });

  let hovered = null; // { set, materials }
  let selected = null; // { set, materials }
  const transitions = new Map(); // material -> { from, to, t }

  /** The materials an option change applies to: the clicked one, or the whole set. */
  const targetsFor = (material, item = null) => {
    const config = material?.userData.configurable;
    if (!config) return { item, set: null, materials: [] };
    const { set } = config;
    return { item, set, materials: set.each ? [material] : set.materials };
  };

  const partLabel = (set, item) => {
    if (!item) return set.label;
    const labels = {
      timber: 'Timber', kidChair: item.label.toLowerCase().includes('table') ? 'Frame' : 'Finish',
      studioTop: 'Table top', nook: 'Shell', pod: 'Shell', pit: 'Upholstery',
      floorCushion: 'Upholstery', bench: 'Upholstery', bean: 'Upholstery', pebble: 'Upholstery',
      stool: 'Upholstery', seat: 'Upholstery', woven: 'Upholstery', sofa: 'Upholstery',
      tiers: 'Upholstery', counter: 'Counter', inlay: 'Inlay', rings: 'Finish', acoustic: 'Panel',
    };
    return labels[set.id] ?? set.label;
  };

  function select(target) {
    selected = target;
    if (!target?.set) {
      onSelect?.(null);
      return;
    }
    const { set, materials } = target;
    onSelect?.({
      label: partLabel(set, target.item),
      options: set.options.map(({ name, color, swatch }) => ({ name, color, swatch })),
      active: materials[0].userData.configurable.option,
      parts: target.item ? [...new Map(target.item.meshes
        .filter((mesh) => mesh.material.userData.configurable)
        .map((mesh) => {
          const part = mesh.material.userData.configurable.set;
          return [part.id, { id: part.id, label: partLabel(part, target.item) }];
        })).values()] : [],
      part: set.id,
    });
  }

  function applyOption(index) {
    if (!selected?.set || !selected.set.options[index]) return;
    const option = selected.set.options[index];
    for (const material of selected.materials) {
      material.userData.configurable.option = index;
      transitions.set(material, {
        from: { color: material.color.clone(), roughness: material.roughness, metalness: material.metalness },
        to: { color: new THREE.Color(option.color), roughness: option.roughness, metalness: option.metalness },
        t: 0,
      });
    }
    select(selected);
    onInteract?.('material');
  }

  function updateMaterials(dt, time) {
    for (const [material, tr] of transitions) {
      tr.t = Math.min(1, tr.t + dt / 0.7);
      const k = easeInOut(tr.t);
      material.color.lerpColors(tr.from.color, tr.to.color, k);
      material.roughness = THREE.MathUtils.lerp(tr.from.roughness, tr.to.roughness, k);
      material.metalness = THREE.MathUtils.lerp(tr.from.metalness, tr.to.metalness, k);
      if (tr.t === 1) transitions.delete(material);
    }
    // Gentle glow on the hovered set, a slow pulse on the selected one.
    for (const material of configurable) {
      let target = 0;
      if (inspection.focused && selected?.item?.meshes.some((mesh) => mesh.material === material)) target = 0.025;
      else if (selected?.materials.includes(material)) target = 0.07 + 0.05 * Math.sin(time * 4);
      else if (hovered?.materials.includes(material)) target = 0.08;
      material.emissiveIntensity += (target - material.emissiveIntensity) * Math.min(1, dt * 10);
    }
  }

  // -------------------------------------------------------------- floor cursor

  const cursorMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const cursor = new THREE.Group();
  cursor.add(new THREE.Mesh(new THREE.RingGeometry(0.2, 0.235, 64).rotateX(-Math.PI / 2), cursorMaterial));
  cursor.add(new THREE.Mesh(new THREE.CircleGeometry(0.035, 32).rotateX(-Math.PI / 2), cursorMaterial));
  cursor.renderOrder = 10;
  scene.add(cursor);

  const pulseMaterial = cursorMaterial.clone();
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.235, 64).rotateX(-Math.PI / 2), pulseMaterial);
  pulse.renderOrder = 10;
  pulse.visible = false;
  scene.add(pulse);
  let pulseTime = 0;

  let cursorTarget = 0;
  function updateCursor(dt) {
    cursorMaterial.opacity += (cursorTarget - cursorMaterial.opacity) * Math.min(1, dt * 12);
    cursor.visible = cursorMaterial.opacity > 0.01;
    if (pulse.visible) {
      pulseTime += dt / 0.6;
      pulse.scale.setScalar(1 + pulseTime * 1.2);
      pulseMaterial.opacity = 0.9 * (1 - pulseTime);
      if (pulseTime >= 1) pulse.visible = false;
    }
  }

  // -------------------------------------------------------------- camera

  let entered = false;
  let fov = 60;
  let targetFov = 60;
  const view = anglesTo(INTRO.position, INTRO.lookAt);
  const look = { ...view };
  camera.position.copy(INTRO.position);
  let glide = null; // { from, to, t, duration, fromYaw?, toYaw?, ... }

  function moveTo(point) {
    const to = new THREE.Vector3(
      THREE.MathUtils.clamp(point.x, ROOM.minX + WALL_MARGIN, ROOM.maxX - WALL_MARGIN),
      EYE_HEIGHT,
      THREE.MathUtils.clamp(point.z, ROOM.minZ + WALL_MARGIN, ROOM.maxZ - WALL_MARGIN)
    );
    const distance = to.distanceTo(camera.position);
    glide = { from: camera.position.clone(), to, t: 0, duration: THREE.MathUtils.clamp(distance / 2.2, 0.8, 2.4) };

    pulse.position.set(to.x, 0.006, to.z);
    pulse.visible = true;
    pulseTime = 0;
  }

  function enter() {
    const start = anglesTo(START.position, START.lookAt);
    glide = {
      from: camera.position.clone(), to: START.position.clone(), t: 0, duration: 3.2,
      fromYaw: look.yaw, toYaw: start.yaw, fromPitch: look.pitch, toPitch: start.pitch,
      onDone: () => { entered = true; },
    };
  }

  function updateCamera(dt, time) {
    if (glide) {
      glide.t = Math.min(1, glide.t + dt / glide.duration);
      const k = easeInOut(glide.t);
      camera.position.lerpVectors(glide.from, glide.to, k);
      if (glide.toYaw !== undefined) {
        look.yaw = view.yaw = glide.fromYaw + angleDelta(glide.fromYaw, glide.toYaw) * k;
        look.pitch = view.pitch = THREE.MathUtils.lerp(glide.fromPitch, glide.toPitch, k);
      }
      if (glide.t === 1) {
        const done = glide.onDone;
        glide = null;
        done?.();
      }
    } else if (!entered) {
      // Slow idle sway behind the landing screen.
      view.yaw = anglesTo(INTRO.position, INTRO.lookAt).yaw + Math.sin(time * 0.15) * 0.12;
    }

    // Damped look so dragging feels weighty.
    const damping = Math.min(1, dt * 8);
    look.yaw += angleDelta(look.yaw, view.yaw) * damping;
    look.pitch += (view.pitch - look.pitch) * damping;
    camera.rotation.set(look.pitch, look.yaw, 0);

    fov += (targetFov - fov) * damping;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  // -------------------------------------------------------------- pointer input

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let press = null; // { x, y, dragged }

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    // Glass, sea and sky let clicks pass through.
    const hit = raycaster.intersectObject(space.group, true).find((h) => !h.object.userData.noPick);
    if (!hit) return null;
    if (hit.object.userData.floor) return { floor: hit.point };
    const item = space.items.get(hit.object.userData.itemId);
    if (item || hit.object.material.userData.configurable) return { material: hit.object.material, item };
    return null;
  }

  function updateHover(event) {
    if (inspection.active || !entered || glide || press?.dragged) {
      hovered = null;
      cursorTarget = 0;
      return;
    }
    const hit = pick(event);
    hovered = hit?.material ? targetsFor(hit.material, hit.item) : null;
    if (hit?.floor) {
      cursor.position.set(hit.floor.x, 0.005, hit.floor.z);
      cursorTarget = 0.85;
    } else {
      cursorTarget = 0;
    }
    canvas.style.cursor = hovered ? 'pointer' : press ? 'grabbing' : 'grab';
  }

  const onPointerDown = (e) => {
    if (!entered || glide || inspection.active || e.button !== 0) return;
    press = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, dragged: false };
    canvas.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (inspection.active) return;
    if (press) {
      const dx = e.clientX - press.lastX;
      const dy = e.clientY - press.lastY;
      press.lastX = e.clientX;
      press.lastY = e.clientY;
      if (!press.dragged && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD) {
        press.dragged = true;
        canvas.style.cursor = 'grabbing';
      }
      if (press.dragged) {
        // "Grab" the scene: it follows the pointer. Scaled by FOV so zoomed views turn slower.
        const speed = LOOK_SPEED * (fov / 60);
        view.yaw += dx * speed;
        view.pitch = THREE.MathUtils.clamp(view.pitch + dy * speed, -1.1, 1.1);
        onInteract?.('look');
      }
    }
    updateHover(e);
  };

  const onPointerUp = (e) => {
    if (inspection.active) return;
    if (!press) return;
    const wasDrag = press.dragged;
    press = null;
    if (wasDrag) {
      updateHover(e);
      return;
    }
    const hit = pick(e);
    if (hit?.material) {
      const material = hit.material.userData.configurable ? hit.material
        : hit.item?.meshes.find((mesh) => mesh.material.userData.configurable)?.material;
      select(targetsFor(material, hit.item));
      if (hit.item) {
        hovered = null;
        cursorTarget = 0;
        cursorMaterial.opacity = 0;
        pulse.visible = false;
        canvas.style.cursor = 'grab';
        inspection.open(hit.item);
        renderer.shadowMap.needsUpdate = true;
        onInteract?.('inspect');
      }
    } else if (hit?.floor) {
      select(null);
      moveTo(hit.floor);
      cursorTarget = 0;
      onInteract?.('move');
    } else {
      select(null);
    }
  };

  const onWheel = (e) => {
    if (!entered || inspection.active) return;
    e.preventDefault();
    targetFov = THREE.MathUtils.clamp(targetFov + e.deltaY * 0.03, MIN_FOV, MAX_FOV);
  };

  const onPointerLeave = () => {
    cursorTarget = 0;
    hovered = null;
  };
  const closeInspection = () => {
    inspection.close();
    select(null);
    press = null;
    renderer.shadowMap.needsUpdate = true;
    canvas.style.cursor = 'grab';
  };
  const onPointerCancel = () => { press = null; hovered = null; cursorTarget = 0; };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (inspection.active) closeInspection();
      else select(null);
    }
    if (inspection.active && e.target === canvas) {
      if (e.key === '+' || e.key === '=') inspection.zoom(0.85);
      if (e.key === '-') inspection.zoom(1.15);
      if (e.key.toLowerCase() === 'r') inspection.reset();
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);

  // -------------------------------------------------------------- loop

  const resizeObserver = new ResizeObserver(() => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    inspection.resize();
  });
  resizeObserver.observe(canvas);

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.1);
    const time = timer.getElapsed();
    if (inspection.active) inspection.update(dt);
    else updateCamera(dt, time);
    space.update(dt);
    updateMaterials(dt, time);
    updateCursor(dt);
    composer.render(dt);
  });

  const ready = renderer.compileAsync(scene, camera).catch(() => {});

  return {
    ready,
    enter,
    applyOption,
    selectPart(id) {
      const material = selected?.item?.meshes.find((mesh) => mesh.material.userData.configurable?.set.id === id)?.material;
      if (material) select(targetsFor(material, selected.item));
    },
    closeInspection,
    resetInspection: () => inspection.reset(),
    rotateInspection: () => inspection.rotate(),
    zoomInspection: (factor) => inspection.zoom(factor),
    orbitInspection: (angle) => inspection.orbit(angle),
    closePalette: () => select(null),
    dispose() {
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      timer.dispose();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      inspection.dispose();

      const materials = new Set([cursorMaterial, pulseMaterial, sky.material]);
      const geometries = new Set([pulse.geometry, sky.geometry]);
      cursor.children.forEach((m) => geometries.add(m.geometry));
      space.group.traverse((o) => {
        if (!o.isMesh) return;
        geometries.add(o.geometry);
        materials.add(o.material);
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => {
        m.map?.dispose();
        m.bumpMap?.dispose();
        m.dispose();
      });
      composer.dispose();
      ao.dispose();
      bloom.dispose();
      outline.dispose();
      target.dispose();
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
