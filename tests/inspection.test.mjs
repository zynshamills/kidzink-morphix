import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildCommons, ROOM } from '../lib/commons.js';
import { getItemBounds, getFocusView, createItemInspection } from '../lib/inspection.js';

// These tests exercise real scene geometry and batching. Only texture painting is stubbed.
const context = new Proxy({
  createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
}, { get: (target, key) => target[key] ?? (() => {}) });
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const space = buildCommons();
const items = [...space.items.values()];
const boundsFor = (item) => getItemBounds(item);

test('all selectable furniture keeps item ownership after static batching', () => {
  const architecture = new Set(['timber', 'column', 'walls', 'slats']);
  space.group.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const config = mesh.material.userData.configurable;
    if (config && !architecture.has(config.set.id)) assert.ok(space.items.has(mesh.userData.itemId), config.set.id);
    if (mesh.userData.itemId) {
      const item = space.items.get(mesh.userData.itemId);
      assert.ok(item.meshes.includes(mesh));
      assert.ok(!mesh.userData.floor && !mesh.userData.noPick);
    }
  });
  for (const item of items) {
    const bounds = boundsFor(item);
    assert.ok(!bounds.isEmpty(), item.label);
    assert.ok(bounds.min.toArray().every(Number.isFinite), item.label);
  }
});

test('individual chairs include the entire frame and exclude nearby chairs and tables', () => {
  const chairs = items.filter((item) => item.label === "Children's chair");
  assert.equal(chairs.length, 12);
  for (const chair of chairs) {
    const size = getItemBounds(chair).getSize(new THREE.Vector3());
    assert.ok(size.y > 0.63 && size.y < 0.7);
    assert.ok(size.x < 0.6 && size.z < 0.6);
    const vertices = chair.meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);
    assert.ok(vertices > 1000, 'seat, back, legs and crossbars survive batching');
  }
});

test('learning tables include their legs and both configurable finishes', () => {
  const tables = items.filter((item) => item.label === 'Trapezoid learning table');
  assert.equal(tables.length, 4);
  for (const table of tables) {
    const size = getItemBounds(table).getSize(new THREE.Vector3());
    assert.ok(size.y > 0.55 && size.y < 0.6);
    const parts = new Set(table.meshes.map((mesh) => mesh.material.userData.configurable?.set.id));
    assert.deepEqual(parts, new Set(['kidChair', 'studioTop']));
  }
});

test('finishes are scoped to one furniture instance', () => {
  const chairs = items.filter((item) => item.label === "Children's chair");
  const first = chairs[0].meshes[0].material;
  const second = chairs[1].meshes[0].material;
  assert.notEqual(first, second);
  assert.notEqual(first.userData.configurable.set, second.userData.configurable.set);
  assert.deepEqual(first.userData.configurable.set.materials, [first]);
});

test('interactive display bounds distinguish it from the surrounding cabinetry', () => {
  const display = items.find((item) => item.label === 'Interactive display');
  assert.ok(display);
  const size = getItemBounds(display).getSize(new THREE.Vector3());
  assert.equal(display.meshes.length, 2);
  assert.ok(size.x < 1.6 && size.y < 0.9 && size.z < 0.1);
});

test('built-in reading nooks are separate from the storage cabinet', () => {
  const nooks = items.filter((item) => item.label === 'Reading nook');
  assert.equal(nooks.length, 2);
  for (const nook of nooks) {
    const size = getItemBounds(nook).getSize(new THREE.Vector3());
    assert.ok(size.x < 1.3 && size.y < 1.9 && size.z < 0.6);
  }
  const cabinet = items.find((item) => item.label === 'Studio storage cabinet');
  assert.ok(cabinet);
  assert.ok(cabinet.meshes.every((mesh) => !nooks.some((nook) => nook.meshes.includes(mesh))));
});

test('focus targets the actual item location and keeps the camera within the room', () => {
  const from = new THREE.Vector3(7.2, 1.5, -0.3);
  for (const item of items) {
    for (const [width, height] of [[1280, 800], [390, 844], [844, 390]]) {
      const focus = getFocusView(item, from, width, height, ROOM);
      assert.ok(focus.target.distanceTo(getItemBounds(item).getCenter(new THREE.Vector3())) < 0.00001);
      assert.ok(focus.position.toArray().every(Number.isFinite), item.label);
      assert.ok(focus.position.x >= ROOM.minX && focus.position.x <= ROOM.maxX, item.label);
      assert.ok(focus.position.z >= ROOM.minZ && focus.position.z <= ROOM.maxZ, item.label);
      assert.ok(focus.position.y > 0 && focus.position.y < ROOM.height, item.label);
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(focus.quaternion);
      assert.ok(direction.dot(focus.target.clone().sub(focus.position).normalize()) > 0.99999);
    }
  }
});

test('focus moves the existing camera smoothly, preserves surroundings and restores the original view', () => {
  const doc = { addEventListener() {}, removeEventListener() {} };
  const canvas = {
    clientWidth: 1000, clientHeight: 800, style: {}, ownerDocument: doc,
    addEventListener() {}, removeEventListener() {}, getRootNode: () => doc,
  };
  const camera = new THREE.PerspectiveCamera(60, 1.25, 0.05, 6000);
  camera.position.set(7.2, 1.5, -0.3);
  camera.lookAt(-4, 0.9, 2.4);
  const originalPosition = camera.position.clone();
  const originalRotation = camera.quaternion.clone();
  const snapshot = [];
  space.group.traverse((object) => snapshot.push({ object, parent: object.parent, visible: object.visible, position: object.position.clone(), scale: object.scale.clone() }));
  const item = items.find((entry) => entry.label === 'Drum stool');
  const events = [];
  const focus = createItemInspection(canvas, camera, ROOM, (event) => events.push(event));
  focus.open(item);
  assert.deepEqual(camera.position, originalPosition, 'focus starts from the current camera pose');
  focus.update(0.4);
  const midway = camera.position.clone();
  assert.ok(midway.distanceTo(originalPosition) > 0.01);
  focus.update(1);
  assert.ok(camera.position.distanceTo(midway) > 0.01);
  assert.ok(focus.active && focus.focused);
  for (let i = 0; i < 8; i++) { focus.orbit(Math.PI / 4); focus.update(0.1); }
  focus.zoom(0.7);
  focus.update(0.1);
  assert.ok(camera.position.y > 0 && camera.position.y < ROOM.height);
  assert.ok(camera.position.x >= ROOM.minX && camera.position.x <= ROOM.maxX);
  assert.ok(camera.position.z >= ROOM.minZ && camera.position.z <= ROOM.maxZ);
  for (const before of snapshot) {
    assert.equal(before.object.parent, before.parent);
    assert.equal(before.object.visible, before.visible);
    assert.deepEqual(before.object.position, before.position);
    assert.deepEqual(before.object.scale, before.scale);
  }
  focus.close();
  assert.equal(focus.focused, false);
  assert.equal(focus.active, true, 'camera remains controlled while returning');
  focus.update(1);
  assert.equal(focus.active, false);
  assert.ok(camera.position.distanceTo(originalPosition) < 0.00001);
  assert.ok(camera.quaternion.angleTo(originalRotation) < 0.00001);
  assert.equal(camera.fov, 60);
  assert.ok(!camera.view?.enabled);
  assert.equal(events[0].id, item.id);
  assert.equal(events.at(-1), null);
  focus.dispose();
});


