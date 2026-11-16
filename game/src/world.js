// DUSK YARD: an original industrial yard, 44 x 32 m, built from boxes, containers and
// pipes. Two lanes run up the west (A) and east (B) sides, mid is a container wall with
// two gaps, and the bomb sites sit in the north-west (A) and north-east (B) corners.
// Every box is a collider for movement and a surface a bullet stops on.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Nav-graph nodes the bots walk: name, x, z. Edges join neighbours a bot can walk between.
export const NAV_NODES = {
  tSpawn: [0, 13],
  tMid: [0, 8],
  yardW: [-10, 6],
  yardE: [10, 6],
  midW: [-9, 2],
  midE: [9, 2],
  midLow: [0, 3],
  midGapW: [-5, -2],
  midGapE: [5, -2],
  midTop: [0, -6],
  aLane1: [-18.5, 6],
  aLane2: [-18.5, -2],
  aLane3: [-18.5, -9],
  bLane1: [18.5, 6],
  bLane2: [18.5, -2],
  bLane3: [18.5, -9],
  siteA: [-14, -11],
  siteA2: [-9, -12.5],
  siteB: [14, -11],
  siteB2: [9, -12.5],
  ctSpawn: [0, -13],
  ctMid: [0, -9],
  aHold: [-11, -8],
  bHold: [11, -8],
};
export const NAV_EDGES = [
  ['tSpawn', 'tMid'], ['tSpawn', 'yardW'], ['tSpawn', 'yardE'],
  ['tMid', 'midLow'], ['tMid', 'yardW'], ['tMid', 'yardE'],
  ['yardW', 'midW'], ['yardE', 'midE'],
  ['midW', 'midGapW'], ['midE', 'midGapE'],
  ['midLow', 'midGapW'], ['midLow', 'midGapE'],
  ['midGapW', 'midTop'], ['midGapE', 'midTop'],
  ['midGapW', 'aLane2'], ['midGapE', 'bLane2'],
  ['midTop', 'ctMid'], ['midTop', 'aHold'], ['midTop', 'bHold'],
  ['aLane1', 'aLane2'], ['aLane2', 'aLane3'], ['aLane3', 'siteA'],
  ['bLane1', 'bLane2'], ['bLane2', 'bLane3'], ['bLane3', 'siteB'],
  ['aLane1', 'yardW'], ['bLane1', 'yardE'],
  ['siteA', 'siteA2'], ['siteB', 'siteB2'],
  ['siteA2', 'ctMid'], ['siteB2', 'ctMid'],
  ['ctMid', 'ctSpawn'], ['aHold', 'siteA'], ['bHold', 'siteB'],
  ['ctSpawn', 'aLane3'], ['ctSpawn', 'bLane3'],
];

export const SITES = {
  A: { x: -14, z: -11, label: 'SITE A' },
  B: { x: 14, z: -11, label: 'SITE B' },
};
export const SPAWNS = {
  ember: [[-3, 13], [-1, 13.5], [1, 13.5], [3, 13], [0, 14.5]],
  frost: [[-3, -13], [-1, -13.5], [1, -13.5], [3, -13], [0, -14.5]],
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: name === 'hairline' ? 0.35 : 0.04,
    });
  }
  // Glowing site paint: emissive so the objective reads at a glance in the dusk.
  const siteMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent),
    emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 0.55,
    roughness: 0.6,
  });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(radius, height, x, y, z, material, segments = 18) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter: a walled yard, open to the dusk sky.
  box(44.4, 0.4, 32.4, 0, -0.2, 0, 'surface');
  box(0.4, 4.2, 32.4, -22.2, 2.1, 0, 'concrete');
  box(0.4, 4.2, 32.4, 22.2, 2.1, 0, 'concrete');
  box(44.4, 4.2, 0.4, 0, 2.1, -16.2, 'concrete');
  box(44.4, 4.2, 0.4, 0, 2.1, 16.2, 'concrete');

  // Mid wall: two stacked container rows with a gap at x = -5 and x = +5 (the mid doors).
  box(6.2, 2.6, 2.4, -8.2, 1.3, -2, 'rust');
  box(6.2, 2.6, 2.4, -8.2, 3.9, -2, 'teal');
  box(6.2, 2.6, 2.4, 8.2, 1.3, -2, 'rust');
  box(6.2, 2.6, 2.4, 8.2, 3.9, -2, 'ochre');
  box(3.6, 2.6, 2.4, 0, 1.3, -2, 'olive');
  // Mid crates to crouch behind while crossing.
  box(1.4, 0.9, 1.4, -2.6, 0.45, 1.6, 'hairline');
  box(1.4, 0.9, 1.4, 2.8, 0.45, 0.6, 'hairline');
  box(1.2, 1.8, 1.2, -0.4, 0.9, -5.4, 'teal');

  // A lane (west): a container row forces the lane against the wall, with cover crates.
  box(2.4, 2.6, 9.0, -15.4, 1.3, 2, 'teal');
  box(2.4, 2.6, 6.0, -15.4, 1.3, -7.5, 'rust');
  box(1.4, 0.9, 1.4, -18.6, 0.45, 1.5, 'hairline');
  box(1.4, 0.9, 1.4, -18.4, 0.45, -5.5, 'hairline');
  box(1.2, 1.8, 1.2, -19.6, 0.9, -12.5, 'ochre');
  // B lane (east): mirrored, different colours so the lanes read apart.
  box(2.4, 2.6, 9.0, 15.4, 1.3, 2, 'ochre');
  box(2.4, 2.6, 6.0, 15.4, 1.3, -7.5, 'olive');
  box(1.4, 0.9, 1.4, 18.6, 0.45, 1.5, 'hairline');
  box(1.4, 0.9, 1.4, 18.4, 0.45, -5.5, 'hairline');
  box(1.2, 1.8, 1.2, 19.6, 0.9, -12.5, 'teal');

  // Site A: a low platform, a container back wall and stacked crates for angles.
  box(7.0, 0.5, 5.0, -14, 0.25, -11, 'concrete');
  box(6.0, 2.6, 1.2, -14, 1.55, -14.6, 'rust');
  box(1.4, 0.9, 1.4, -11.2, 0.95, -9.2, 'hairline');
  box(1.4, 0.9, 1.4, -16.8, 0.45, -8.6, 'hairline');
  box(1.2, 1.8, 1.2, -10.6, 0.9, -13.6, 'olive');
  // Site B: mirrored with a different stack.
  box(7.0, 0.5, 5.0, 14, 0.25, -11, 'concrete');
  box(6.0, 2.6, 1.2, 14, 1.55, -14.6, 'teal');
  box(1.4, 0.9, 1.4, 11.2, 0.95, -9.2, 'hairline');
  box(1.4, 0.9, 1.4, 16.8, 0.45, -8.6, 'hairline');
  box(1.2, 1.8, 1.2, 10.6, 0.9, -13.6, 'rust');

  // South yard dressing: a silo, pipes along the wall, and a forklift-sized crate stack.
  cylinder(1.6, 5.2, -19.5, 2.6, 9, 'concrete');
  cylinder(0.28, 20, 0, 1.1, 15.6, 'hairline');
  cylinder(0.22, 20, 0, 0.7, 15.9, 'rust');
  // A barrel cluster mid-yard: low cover on the walk from spawn to mid.
  cylinder(0.45, 1.0, -5.5, 0.5, 9.5, 'rust');
  cylinder(0.45, 1.0, -4.6, 0.5, 9.8, 'teal');
  cylinder(0.45, 1.0, 5.5, 0.5, 9.5, 'ochre');
  cylinder(0.45, 1.0, 6.4, 0.5, 9.8, 'rust');
  box(2.6, 1.1, 1.6, -7, 0.55, 12.5, 'olive');
  box(1.6, 1.1, 1.6, 7.5, 0.55, 12.8, 'rust');
  box(1.4, 0.9, 1.4, 12, 0.45, 4.5, 'hairline');
  box(1.4, 0.9, 1.4, -12, 0.45, 4.5, 'hairline');

  // Site markers: glowing amber strips painted on the platforms, plus a pole light each.
  const siteMarkers = {};
  for (const key of Object.keys(SITES)) {
    const site = SITES[key];
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.5), siteMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(site.x, 0.53, site.z + 1.6);
    group.add(strip);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 8), materials.hairline);
    pole.position.set(site.x + 2.8, 1.7, site.z - 2.2);
    pole.castShadow = true;
    group.add(pole);
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 6, 9);
    lamp.position.set(site.x + 2.8, 3.4, site.z - 2.2);
    group.add(lamp);
    siteMarkers[key] = { strip, pole, lamp };
  }

  // Light: a low warm sun from the west, a cool violet sky fill, and a faint cool fill
  // from the east so the shadow side never goes black.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8a7bb0'), new THREE.Color('#2a2433'), 0.85);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.sun), 2.6);
  sun.position.set(-26, 11, 14);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7a86c8'), 0.5);
  fill.position.set(18, 12, -10);
  scene.add(fill);

  return { colliders, shootables, group, siteMarkers };
}
