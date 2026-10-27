import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const UP = new THREE.Vector3(0, 1, 0);
const ease = (t) => t * t * (3 - 2 * t);

/** Measure the actual furniture in world space; never move or copy it out of the room. */
export function getItemBounds(item) {
  const bounds = new THREE.Box3();
  for (const mesh of item.meshes) {
    mesh.updateWorldMatrix(true, false);
    bounds.union(new THREE.Box3().setFromObject(mesh));
  }
  return bounds;
}

function keepInRoom(position, room) {
  position.x = THREE.MathUtils.clamp(position.x, room.minX + 0.32, room.maxX - 0.32);
  position.z = THREE.MathUtils.clamp(position.z, room.minZ + 0.32, room.maxZ - 0.32);
  position.y = THREE.MathUtils.clamp(position.y, 0.3, room.height - 0.3);
  return position;
}

/** Frame the selected item from the visitor's current side, with room around its silhouette. */
export function getFocusView(item, from, width, height, room) {
  const bounds = getItemBounds(item);
  const target = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const direction = from.clone().sub(target);
  const horizontalDistance = Math.hypot(direction.x, direction.z);
  const elevation = THREE.MathUtils.clamp(Math.atan2(Math.max(0.35, direction.y), horizontalDistance), 0.2, 0.5);
  direction.y = 0;
  if (direction.lengthSq() < 0.001) direction.set(0, 0, 1);
  direction.normalize().multiplyScalar(Math.cos(elevation));
  direction.y = Math.sin(elevation);
  const right = new THREE.Vector3().crossVectors(UP, direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right);
  const fov = 55;
  const landscape = width > height && height <= 540;
  const usableHeight = Math.max(0.4, (height - (landscape ? 155 : 255)) / height);
  const vertical = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * usableHeight;
  const horizontal = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * width / height * 0.84;
  let distance = 0.8;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const corner = new THREE.Vector3(x, y, z).sub(target);
        const depth = corner.dot(direction);
        distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / horizontal, depth + Math.abs(corner.dot(up)) / vertical);
      }
    }
  }
  const position = keepInRoom(target.clone().addScaledVector(direction, distance * 1.12), room);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(position, target, UP));
  return { position, quaternion, target, size, fov, offset: landscape ? 0.03 : 0.07 };
}

/** Focus and orbit the existing room camera. The main viewer continues rendering the full scene. */
export function createItemInspection(canvas, camera, room, onChange) {
  let controls = null;
  let current = null;
  let saved = null;
  let home = null;
  let transition = null;
  const safePosition = new THREE.Vector3();

  const pose = () => ({
    position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov,
    offset: camera.view?.enabled ? camera.view.offsetY / camera.view.fullHeight : 0,
  });
  const project = (fov, offset) => {
    camera.fov = fov;
    if (offset) camera.setViewOffset(canvas.clientWidth, canvas.clientHeight, 0, canvas.clientHeight * offset, canvas.clientWidth, canvas.clientHeight);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  const notify = () => onChange?.(current ? { id: current.id, label: current.label, rotating: controls?.autoRotate ?? false } : null);

  function disconnect() {
    controls?.dispose();
    controls = null;
    canvas.style.touchAction = 'none';
  }

  function constrain() {
    if (!controls) return;
    const requested = camera.position.clone();
    keepInRoom(camera.position, room);
    if (camera.position.distanceTo(controls.target) < controls.minDistance * 0.95) camera.position.copy(safePosition);
    if (!requested.equals(camera.position)) {
      if (controls.autoRotate) controls.autoRotateSpeed *= -1;
      camera.lookAt(controls.target);
    }
    safePosition.copy(camera.position);
  }

  function connect() {
    const before = pose();
    controls = new OrbitControls(camera, canvas);
    controls.target.copy(home.target);
    camera.position.copy(before.position);
    camera.quaternion.copy(before.quaternion);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.autoRotateSpeed = 1;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI / 2 - 0.015;
    const distance = camera.position.distanceTo(home.target);
    controls.minDistance = Math.min(distance, Math.max(0.45, home.size.length() * 0.55));
    controls.maxDistance = Math.max(distance * 1.8, controls.minDistance + 1);
    safePosition.copy(camera.position);
    controls.update();
    constrain();
    notify();
  }

  function travel(to, duration, done) {
    disconnect();
    transition = { from: pose(), to, duration, elapsed: 0, done };
  }

  function open(item) {
    if (!saved) saved = pose();
    current = item;
    home = getFocusView(item, camera.position, canvas.clientWidth, canvas.clientHeight, room);
    travel(home, 1.05, connect);
    notify();
  }

  function close() {
    if (!current || !saved) return;
    current = null;
    travel(saved, 0.85, () => { saved = null; home = null; });
    notify();
  }

  function update(dt) {
    if (transition) {
      transition.elapsed += dt;
      const t = Math.min(1, transition.elapsed / transition.duration);
      const k = ease(t);
      camera.position.lerpVectors(transition.from.position, transition.to.position, k);
      camera.quaternion.slerpQuaternions(transition.from.quaternion, transition.to.quaternion, k);
      project(THREE.MathUtils.lerp(transition.from.fov, transition.to.fov, k), THREE.MathUtils.lerp(transition.from.offset, transition.to.offset, k));
      if (t === 1) {
        const done = transition.done;
        transition = null;
        done?.();
      }
    } else if (controls) {
      controls.update(dt);
      constrain();
    }
  }

  return {
    get active() { return !!current || !!transition; },
    get focused() { return !!current; },
    open, close, update,
    resize() {
      if (!current) return;
      home = getFocusView(current, camera.position, canvas.clientWidth, canvas.clientHeight, room);
      travel(home, 0.35, connect);
      notify();
    },
    reset() {
      if (!current) return;
      travel(home, 0.55, connect);
      notify();
    },
    rotate() {
      if (!controls) return;
      controls.autoRotate = !controls.autoRotate;
      notify();
    },
    zoom(factor) {
      if (!controls) return;
      camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target);
      controls.update();
      constrain();
    },
    orbit(angle) {
      if (!controls) return;
      camera.position.sub(controls.target).applyAxisAngle(UP, angle).add(controls.target);
      controls.update();
      constrain();
    },
    dispose() {
      disconnect();
      transition = null;
      if (saved) {
        camera.position.copy(saved.position);
        camera.quaternion.copy(saved.quaternion);
        project(saved.fov, saved.offset);
      }
      current = saved = home = null;
    },
  };
}

