// The armoury: five weapons and a smoke grenade. Each entry owns its numbers — damage,
// headshot multiplier, fire rate, magazine, spread, recoil and price — so main.js only
// asks "can it fire" and "how wide is the cone". The view model is built per weapon
// type from boxes, with a muzzle flash and a kick that recovers every frame.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', kind: 'pistol', price: 0,
    damage: 26, headMult: 3, magSize: 12, reserve: 48,
    fireGap: 0.18, reloadTime: 1.4, auto: false,
    spreadStill: 0.002, spreadMove: 0.02, recoil: 0.008, pellets: 1, zoom: 1,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Rifle', kind: 'rifle', price: 2700,
    damage: 34, headMult: 2.5, magSize: 30, reserve: 90,
    fireGap: 0.1, reloadTime: 1.9, auto: true,
    spreadStill: 0.0022, spreadMove: 0.028, recoil: 0.011, pellets: 1, zoom: 1,
  },
  smg: {
    id: 'smg', name: 'Raptor-9 SMG', kind: 'smg', price: 1500,
    damage: 22, headMult: 2.5, magSize: 32, reserve: 96,
    fireGap: 0.07, reloadTime: 1.6, auto: true,
    spreadStill: 0.004, spreadMove: 0.024, recoil: 0.006, pellets: 1, zoom: 1,
  },
  sniper: {
    id: 'sniper', name: 'Longbow .50', kind: 'sniper', price: 4750,
    damage: 95, headMult: 4, magSize: 5, reserve: 15,
    fireGap: 1.15, reloadTime: 2.6, auto: false,
    spreadStill: 0.0006, spreadMove: 0.05, recoil: 0.05, pellets: 1, zoom: 2.4,
  },
  shotgun: {
    id: 'shotgun', name: 'Breacher-12', kind: 'shotgun', price: 2000,
    damage: 9, headMult: 2, magSize: 6, reserve: 18,
    fireGap: 0.9, reloadTime: 2.4, auto: false,
    spreadStill: 0.02, spreadMove: 0.035, recoil: 0.03, pellets: 8, zoom: 1,
  },
};
export const WEAPON_ORDER = ['rifle', 'smg', 'sniper', 'shotgun'];
export const SMOKE_PRICE = 300;
const MUZZLE_TIME = 0.06;

function buildViewModel(camera, def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });
  const model = new THREE.Group();
  const add = (w, h, d, x, y, z, mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  };
  if (def.kind === 'pistol') {
    add(0.07, 0.1, 0.24, 0, 0, -0.1, body);
    add(0.06, 0.12, 0.07, 0, -0.09, 0.02, grip);
  } else if (def.kind === 'sniper') {
    add(0.09, 0.1, 0.5, 0, 0, -0.1, body);
    add(0.04, 0.04, 0.62, 0, 0.03, -0.5, grip);
    add(0.06, 0.07, 0.16, 0, 0.09, -0.05, accent); // scope
    add(0.075, 0.08, 0.22, 0, -0.02, 0.32, grip);
  } else if (def.kind === 'shotgun') {
    add(0.1, 0.11, 0.46, 0, 0, -0.08, body);
    add(0.06, 0.06, 0.34, 0, -0.03, -0.3, grip);
    add(0.075, 0.08, 0.22, 0, -0.02, 0.3, grip);
  } else if (def.kind === 'smg') {
    add(0.08, 0.09, 0.34, 0, 0, -0.08, body);
    add(0.04, 0.16, 0.05, 0, -0.11, -0.12, grip);
    add(0.06, 0.07, 0.2, 0, -0.02, 0.26, grip);
  } else {
    add(0.09, 0.1, 0.42, 0, 0, -0.1, body);
    add(0.045, 0.045, 0.4, 0, 0.025, -0.48, grip);
    add(0.075, 0.08, 0.22, 0, -0.02, 0.3, grip);
    add(0.02, 0.05, 0.1, 0, 0.07, -0.2, accent); // front sight
  }
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);
  return { model, flash, flashLight };
}

export function createWeapon(camera) {
  let def = WEAPONS.rifle;
  let view = buildViewModel(camera, def);
  const state = {
    id: def.id, mag: def.magSize, reserve: def.reserve,
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, smoke: 0,
  };

  function equip(id) {
    if (id === state.id) return;
    def = WEAPONS[id];
    camera.remove(view.model, view.flash, view.flashLight);
    view = buildViewModel(camera, def);
    state.id = id;
    state.mag = def.magSize;
    state.reserve = def.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    view.model.position.z = -0.42 + state.kick;
    view.model.rotation.x = state.kick * 2.2;
    view.flash.visible = state.flash > 0;
    view.flash.rotation.z = state.flash * 30;
    view.flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      view.model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.magSize - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    get def() { return def; },
    step,
    equip,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def.fireGap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.magSize || state.reserve === 0) return;
      state.reloadLeft = def.reloadTime;
    },
    // Spread grows with speed and while airborne, and shrinks while aiming down
    // sights: stopping to aim pays.
    spread(speed, airborne, crouched, aiming) {
      const move = Math.min(1, speed / 5.2);
      let value = def.spreadStill + move * def.spreadMove;
      if (airborne) value += 0.02;
      if (crouched) value *= 0.7;
      if (aiming) value *= 0.6;
      return value;
    },
    refill() {
      state.mag = def.magSize;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    giveSmoke() {
      state.smoke = 1;
    },
    takeSmoke() {
      if (state.smoke <= 0) return false;
      state.smoke -= 1;
      return true;
    },
  };
}
