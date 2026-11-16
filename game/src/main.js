// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. The simulation (movement, bots, rounds, bomb) lives in step(); rendering only
// copies state to the camera and the HUD. ?shot=start|play|buy|end with &seed=N poses a
// deterministic frame for a capture, renders it twice, then freezes and sets
// window.__shotReady. window.__game exposes the live state for play-testing.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS } from './world.js';
import { nodePosition } from './nav.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapons.js';
import { createBots, BOT_DAMAGE } from './bots.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createState, BUY_SECONDS, ROUND_SECONDS, PLANT_SECONDS } from './state.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = shot ? mulberry32(seed) : Math.random;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 26, 62);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const game = createState();
const audio = createAudio();
const hud = createHud();
const player = createPlayer(world.colliders);
const weapon = createWeapon(camera);
const bots = createBots(scene, world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 100;

const S = game.state;
const body = player.state;
const playerTarget = { isPlayer: true, crouching: false };
const noises = [];
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const from = new THREE.Vector3();
const to = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

// Tracers: a fixed pool, reused, so firing never allocates.
const tracers = [];
for (let i = 0; i < 8; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }));
  line.visible = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerIndex = 0;
function spawnTracer(a, b) {
  const tracer = tracers[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracers.length;
  const pos = tracer.line.geometry.attributes.position;
  pos.setXYZ(0, a.x, a.y, a.z);
  pos.setXYZ(1, b.x, b.y, b.z);
  pos.needsUpdate = true;
  tracer.line.visible = true;
  tracer.life = shot ? 10 : 0.07;
  tracer.line.material.opacity = 0.9;
}

// Smoke: thrown grenades become spheres that block sight, not bullets.
const smokes = [];
const smokeGeo = new THREE.SphereGeometry(3.2, 16, 12);
const smokeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#b8b4ac'), transparent: true, opacity: 0.42, depthWrite: false });
const grenades = [];
const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#222222'), roughness: 0.6 });

let health = 100;
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let buyMenuOpen = false;
let spectateTarget = null;
let stepDistance = 0;
let lastStepX = body.position.x;
let lastStepZ = body.position.z;
let plantBeepAt = 0;
let bombBeepAt = 0;
const owned = { weapons: ['pistol'], smoke: 0 };
const ammoStore = {};

function saveAmmo() {
  ammoStore[weapon.state.id] = { mag: weapon.state.mag, reserve: weapon.state.reserve };
}
function equipWeapon(id) {
  if (!owned.weapons.includes(id)) return;
  saveAmmo();
  weapon.equip(id);
  const stored = ammoStore[id];
  if (stored) {
    weapon.state.mag = stored.mag;
    weapon.state.reserve = stored.reserve;
  }
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def.name);
}

function buyWeapon(id) {
  const def = WEAPONS[id];
  if (owned.weapons.includes(id) || S.money < def.price) return false;
  S.money -= def.price;
  owned.weapons.push(id);
  ammoStore[id] = { mag: def.magSize, reserve: def.reserve };
  equipWeapon(id);
  audio.buy();
  hud.setMoney(S.money);
  return true;
}

function buySmoke() {
  if (owned.smoke >= 1 || S.money < 300) return false;
  S.money -= 300;
  owned.smoke = 1;
  weapon.giveSmoke();
  audio.buy();
  hud.setMoney(S.money);
  return true;
}

function setBuyMenu(open) {
  buyMenuOpen = open;
  if (open) {
    hud.showBuy(S.money, owned);
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    hud.hideBuy();
    if (S.phase === 'buy' && !shot) input.requestLock();
  }
}

// --- combat ---------------------------------------------------------------

function segmentBlockedBySmoke(ax, ay, az, bx, by, bz) {
  for (const smoke of smokes) {
    const cx = smoke.mesh.position.x;
    const cy = smoke.mesh.position.y;
    const cz = smoke.mesh.position.z;
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const lenSq = abx * abx + aby * aby + abz * abz;
    let t = lenSq ? ((cx - ax) * abx + (cy - ay) * aby + (cz - az) * abz) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + abx * t - cx;
    const py = ay + aby * t - cy;
    const pz = az + abz * t - cz;
    if (px * px + py * py + pz * pz < smoke.r * smoke.r) return true;
  }
  return false;
}

function losClear(ax, ay, az, bx, by, bz) {
  if (segmentBlockedBySmoke(ax, ay, az, bx, by, bz)) return false;
  tmpDir.set(bx - ax, by - ay, bz - az);
  const dist = tmpDir.length();
  if (dist < 0.01) return true;
  tmpDir.multiplyScalar(1 / dist);
  from.set(ax, ay, az);
  raycaster.set(from, tmpDir);
  const hit = raycaster.intersectObjects(world.shootables, false)[0];
  return !hit || hit.distance > dist - 0.3;
}

// Built per shot, not once at module load: the bot hit meshes only exist after
// bots.init() runs at boot, so a list captured earlier would never contain them.
function shootables() {
  return world.shootables.concat(bots.hitMeshes);
}

function shoot(spread) {
  if (!weapon.takeRound()) {
    audio.dryFire();
    weapon.reload();
    return false;
  }
  camera.getWorldDirection(direction);
  muzzle.set(0.24, -0.18, -0.95);
  camera.localToWorld(muzzle);
  const def = weapon.def;
  let killedAnyone = false;
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    direction.x += (rng() * 2 - 1) * spread;
    direction.y += (rng() * 2 - 1) * spread;
    direction.z += (rng() * 2 - 1) * spread;
    direction.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, direction);
    const hit = raycaster.intersectObjects(shootables(), false)[0];
    if (!hit) continue;
    window.__lastShot = {
      part: hit.object.userData.part || null,
      bot: hit.object.userData.bot ? hit.object.userData.bot.name : null,
      distance: hit.distance,
    };
    spawnTracer(muzzle, hit.point);
    const bot = hit.object.userData.bot;
    if (bot && bot.alive) {
      const head = hit.object.userData.part === 'head';
      const amount = Math.round(def.damage * (head ? def.headMult : 1));
      const died = bots.damage(bot, amount, head ? 'head' : 'torso');
      hud.hitMarker(died, shot ? 4000 : 90);
      if (died) {
        killedAnyone = true;
        S.kills += 1;
        S.money += 300;
        audio.kill();
        hud.killfeed('You', bot.name, head);
        hud.setMoney(S.money);
      } else {
        audio.hit();
      }
    }
  }
  weapon.pullTrigger();
  audio.shot(def.kind);
  player.recoil(def.recoil + rng() * 0.004, (rng() * 2 - 1) * 0.004);
  noises.push({ x: body.position.x, z: body.position.z, time: elapsed });
  if (noises.length > 12) noises.shift();
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, def.name);
  if (killedAnyone) checkElimination();
  return killedAnyone;
}

function damagePlayer(amount, head, attackerName) {
  if (!S.playerAlive || S.phase !== 'live') return;
  health -= amount;
  audio.hurt();
  hud.setHealth(health);
  if (health > 0) return;
  health = 0;
  S.playerAlive = false;
  S.deaths += 1;
  hud.killfeed(attackerName, 'You', head);
  hud.showOverlay('dead');
  if (document.pointerLockElement) document.exitPointerLock();
  spectateTarget = bots.bots.find((bot) => bot.team === 'ember' && bot.alive) || null;
  checkElimination();
}

function checkElimination() {
  if (S.phase !== 'live') return;
  if (bots.aliveCount('frost') === 0) finishRound('ember', 'Frost team eliminated');
  else if (bots.aliveCount('ember') === 0 && !S.playerAlive) finishRound('frost', 'Ember team eliminated');
}

// --- bot context: vision, hearing, shooting -------------------------------

function scanBot(bot) {
  const eyeX = bot.group.position.x;
  const eyeY = 1.5;
  const eyeZ = bot.group.position.z;
  const fx = -Math.sin(bot.yaw);
  const fz = -Math.cos(bot.yaw);
  let best = null;
  let bestDist = 38;
  const consider = (target, tx, ty, tz) => {
    const dx = tx - eyeX;
    const dy = ty - eyeY;
    const dz = tz - eyeZ;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 38 || dist >= bestDist) return;
    const dot = (dx * fx + dz * fz) / (dist || 1);
    if (dot < Math.cos(0.95)) return;
    if (!losClear(eyeX, eyeY, eyeZ, tx, ty, tz)) return;
    best = target;
    bestDist = dist;
  };
  if (bot.team === 'frost' && S.playerAlive) {
    playerTarget.crouching = body.crouching;
    consider(playerTarget, body.position.x, body.position.y + (body.crouching ? 0.8 : 1.2), body.position.z);
  }
  for (const other of bots.bots) {
    if (!other.alive || other.team === bot.team) continue;
    consider(other, other.group.position.x, 1.2, other.group.position.z);
  }
  return best;
}

function botShoot(bot, target, dist) {
  let chance = 0.34 * Math.max(0.25, 1 - dist / 60);
  if (target.isPlayer) {
    if (player.groundSpeed() > 2) chance *= 0.65;
    if (body.crouching) chance *= 0.85;
  }
  audio.enemyShot(dist);
  if (rng() > chance) return;
  const head = rng() < 0.12;
  const amount = BOT_DAMAGE * (head ? 2 : 1);
  if (target.isPlayer) {
    damagePlayer(amount, head, bot.name);
  } else {
    const died = bots.damage(target, amount, head ? 'head' : 'torso');
    if (died) hud.killfeed(bot.name, target.name, head);
    checkElimination();
  }
}

function channelDone(bot, kind) {
  if (kind === 'plant') {
    game.plant(S.assignedSite);
    hud.banner(`CHARGE PLANTED — ${S.assignedSite === 'A' ? 'SITE A' : 'SITE B'}`, 'bomb');
    audio.plantDone();
    for (const other of bots.bots) {
      if (other.team === 'frost' && other.alive) bots.assignObjective(other, botCtx());
    }
  } else if (kind === 'defuse') {
    finishRound('frost', 'Charge defused');
  }
}

function botCtx() {
  return {
    time: elapsed,
    roundLive: S.phase === 'live',
    bombPlanted: S.bomb.planted,
    bombSite: S.bomb.site ? game.sitePosition(S.bomb.site) : null,
    assignedSite: game.sitePosition(S.assignedSite),
    playerAlive: S.playerAlive,
    playerPos: body.position,
    noises,
    scan: scanBot,
    botShoot,
    channelDone,
    nodePos: nodePosition,
  };
}

// --- rounds ---------------------------------------------------------------

function beginMatch() {
  game.startMatch();
  health = 100;
  S.playerAlive = true;
  owned.weapons = ['pistol'];
  owned.smoke = 0;
  ammoStore.pistol = undefined;
  weapon.equip('pistol');
  weapon.refill();
  resetPositions();
  hud.setHealth(health);
  hud.setMoney(S.money);
  hud.setScore(S.score.ember, S.score.frost, S.round);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def.name);
  hud.hideBanner();
  setBuyMenu(true);
}

function resetPositions() {
  const spawn = SPAWNS.ember[4];
  player.reset(spawn[0], spawn[1], 0);
  bots.reset(SPAWNS);
  spectateTarget = null;
}

function beginLive() {
  game.startRound();
  resetPositions();
  bots.startRound(botCtx());
  hud.hideBuy();
  buyMenuOpen = false;
  hud.banner(`ROUND ${S.round} — PLANT AT SITE ${S.assignedSite}`, '');
  setTimeout(() => hud.hideBanner(), 3000);
  hud.setTimer(ROUND_SECONDS, false);
}

function finishRound(winner, reason) {
  const won = game.endRound(winner, reason);
  if (!won) return;
  hud.hideBuy();
  buyMenuOpen = false;
  if (winner === 'ember') audio.roundWin();
  else audio.roundLose();
  hud.showOverlay('roundEnd', { win: winner === 'ember', reason });
  if (document.pointerLockElement) document.exitPointerLock();
}

function advanceRound() {
  game.nextRound();
  if (S.phase === 'matchEnd') {
    hud.showOverlay('matchEnd', { win: S.score.ember >= 5, ember: S.score.ember, frost: S.score.frost });
    return;
  }
  health = 100;
  S.playerAlive = true;
  resetPositions();
  weapon.refill();
  hud.setHealth(health);
  hud.setScore(S.score.ember, S.score.frost, S.round);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def.name);
  setBuyMenu(true);
}

// --- smoke grenades --------------------------------------------------------

function throwSmoke() {
  if (!weapon.takeSmoke()) return;
  camera.getWorldDirection(direction);
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.position.copy(camera.position);
  scene.add(mesh);
  grenades.push({
    mesh,
    vel: new THREE.Vector3(direction.x * 14, direction.y * 14 + 3.5, direction.z * 14),
  });
  audio.shot('pistol');
}

function stepGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.vel.y -= 9.8 * dt;
    g.mesh.position.addScaledVector(g.vel, dt);
    if (g.mesh.position.y <= 0.1) {
      g.mesh.position.y = 0.1;
      scene.remove(g.mesh);
      grenades.splice(i, 1);
      const mesh = new THREE.Mesh(smokeGeo, smokeMat);
      mesh.position.set(g.mesh.position.x, 1.6, g.mesh.position.z);
      scene.add(mesh);
      smokes.push({ mesh, r: 3.2, until: elapsed + 14 });
    }
  }
  for (let i = smokes.length - 1; i >= 0; i -= 1) {
    if (elapsed > smokes[i].until) {
      scene.remove(smokes[i].mesh);
      smokes.splice(i, 1);
    }
  }
}

// --- planting ---------------------------------------------------------------

function nearestSite(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const key of Object.keys(SITES)) {
    const site = SITES[key];
    const dx = site.x - x;
    const dz = site.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = key;
    }
  }
  return bestD < 6.25 ? best : null;
}

function stepPlant(dt) {
  const site = S.phase === 'live' && !S.bomb.planted && S.playerAlive ? nearestSite(body.position.x, body.position.z) : null;
  if (site && input.state.keys.has('KeyE')) {
    S.plantProgress += dt / PLANT_SECONDS;
    if (elapsed - plantBeepAt > 0.5) {
      plantBeepAt = elapsed;
      audio.plantBeep();
    }
    hud.setPlant('PLANTING CHARGE — hold E', S.plantProgress);
    if (S.plantProgress >= 1) {
      game.plant(site);
      S.plantProgress = 0;
      hud.setPlant('', 0);
      hud.banner(`CHARGE PLANTED — SITE ${site}`, 'bomb');
      audio.plantDone();
      for (const bot of bots.bots) {
        if (bot.team === 'frost' && bot.alive) bots.assignObjective(bot, botCtx());
      }
    }
  } else {
    if (S.plantProgress > 0) hud.setPlant('', 0);
    S.plantProgress = 0;
  }
}

// --- the fixed step ---------------------------------------------------------

function step(dt) {
  elapsed += dt;
  if (S.phase === 'buy') {
    S.timer -= dt;
    hud.setTimer(S.timer, false);
    if (S.timer <= 0) beginLive();
  } else if (S.phase === 'live') {
    S.timer -= dt;
    if (S.bomb.planted) {
      S.bomb.timer -= dt;
      hud.setTimer(S.bomb.timer, true);
      if (elapsed - bombBeepAt > (S.bomb.timer < 10 ? 0.5 : 1)) {
        bombBeepAt = elapsed;
        audio.plantBeep();
      }
      if (S.bomb.timer <= 0) {
        audio.explosion();
        finishRound('ember', 'Charge detonated');
      }
    } else {
      hud.setTimer(S.timer, false);
      if (S.timer <= 0) finishRound('frost', 'Time expired — Frost holds the yard');
    }
    if (S.phase === 'live') {
      player.step(dt, input.state.keys);
      weapon.step(dt);
      if (!shot) {
        const ctx = botCtx();
        for (const bot of bots.bots) bots.step(bot, dt, ctx);
      }
      stepGrenades(dt);
      stepPlant(dt);
      const moved = Math.hypot(body.position.x - lastStepX, body.position.z - lastStepZ);
      stepDistance += moved;
      lastStepX = body.position.x;
      lastStepZ = body.position.z;
      if (stepDistance > 2.4 && player.groundSpeed() > 1) {
        stepDistance = 0;
        audio.step();
      }
    }
  } else if (S.phase === 'roundEnd') {
    S.timer -= dt;
    hud.setTimer(S.timer, false);
    if (!shot) {
      const ctx = botCtx();
      for (const bot of bots.bots) bots.step(bot, dt, ctx);
    }
    if (S.timer <= 0) advanceRound();
  }
  hud.setScore(S.score.ember, S.score.frost, S.round);
  hud.setMoney(S.money);
}

function syncCamera() {
  if (!S.playerAlive && spectateTarget && spectateTarget.alive) {
    camera.position.set(spectateTarget.group.position.x, 1.6, spectateTarget.group.position.z);
    camera.rotation.set(spectateTarget.pitch || 0, spectateTarget.yaw, 0, 'YXZ');
    return;
  }
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const playing = S.phase === 'live' || S.phase === 'buy';
    const locked = input.state.locked || shot;
    if (playing && locked && S.playerAlive) {
      if (input.state.firing && weapon.ready()) shoot(weapon.spread(player.groundSpeed(), !player.state.onGround, player.state.crouching, input.state.aiming));
      if (input.wasPressed('KeyR')) {
        weapon.reload();
        audio.reload();
      }
      if (input.wasPressed('KeyG')) throwSmoke();
      if (S.phase === 'live') {
        if (input.wasPressed('Digit1')) equipWeapon('rifle');
        if (input.wasPressed('Digit2')) equipWeapon('smg');
        if (input.wasPressed('Digit3')) equipWeapon('sniper');
        if (input.wasPressed('Digit4')) equipWeapon('shotgun');
        if (input.wasPressed('Digit5')) equipWeapon('pistol');
        if (input.wasPressed('KeyQ')) equipWeapon('pistol');
      }
    }
    // Buy keys work whenever the buy phase runs, locked or with the menu open.
    if (S.phase === 'buy') {
      if (input.wasPressed('KeyB')) setBuyMenu(!buyMenuOpen);
      if (input.wasPressed('Digit1')) buyWeapon('rifle');
      if (input.wasPressed('Digit2')) buyWeapon('smg');
      if (input.wasPressed('Digit3')) buyWeapon('sniper');
      if (input.wasPressed('Digit4')) buyWeapon('shotgun');
      if (input.wasPressed('Digit5')) buySmoke();
    }
    // Sniper scope: right mouse narrows the field of view.
    const wantFov = input.state.aiming && weapon.def.kind === 'sniper' ? 74 / weapon.def.zoom : 74;
    if (Math.abs(camera.fov - wantFov) > 0.1) {
      camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 12);
      camera.updateProjectionMatrix();
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    for (const tracer of tracers) {
      if (tracer.life > 0) {
        tracer.life -= dt;
        tracer.line.material.opacity = Math.max(0, tracer.life / 0.07) * 0.9;
        if (tracer.life <= 0) tracer.line.visible = false;
      }
    }
    const gap = 6 + weapon.spread(player.groundSpeed(), !player.state.onGround, player.state.crouching, input.state.aiming) * 900;
    hud.setSpread(gap);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def.name);
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.resume();
    hud.hideOverlay();
  } else if (!buyMenuOpen && S.playerAlive && (S.phase === 'live' || S.phase === 'buy')) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (S.phase === 'menu' || S.phase === 'matchEnd') {
    beginMatch();
    input.requestLock();
  } else if (S.phase === 'roundEnd') {
    advanceRound();
  } else if (S.phase === 'live' || S.phase === 'buy') {
    input.requestLock();
  }
});

hud.onBuy((id) => {
  if (S.phase !== 'buy') return;
  if (id === 'smoke') buySmoke();
  else buyWeapon(id);
});

// --- deterministic screenshot scenes ----------------------------------------

function poseBot(bot, x, z, yaw) {
  bot.group.position.set(x, 0, z);
  bot.yaw = yaw;
  bot.group.rotation.set(0, yaw, 0);
  bot.mode = 'hold';
  bot.holdYaw = yaw;
  bot.holdUntil = 99999;
  bot.target = null;
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  buyMenuOpen = false;
  bots.init(SPAWNS);
  if (name === 'start') {
    game.startMatch();
    S.round = 1;
    resetPositions();
    body.yaw = 0;
    body.pitch = 0;
    settle(10);
    aimAt(new THREE.Vector3(0, 1.6, -8));
    hud.showOverlay('start');
  } else if (name === 'play') {
    game.startMatch();
    S.round = 3;
    S.score.ember = 2;
    S.score.frost = 1;
    S.money = 3250;
    game.startRound();
    resetPositions();
    body.position.set(0, 0, 6);
    body.yaw = 0;
    body.pitch = 0;
    const ember = bots.bots.filter((b) => b.team === 'ember');
    const frost = bots.bots.filter((b) => b.team === 'frost');
    poseBot(ember[0], -3.5, 4, 0);
    poseBot(ember[1], 4, 5, 0);
    poseBot(ember[2], -7, 1, 0.5);
    poseBot(ember[3], 7.5, 2, -0.5);
    poseBot(frost[0], -4, -1, Math.PI);
    poseBot(frost[1], 2, -3, Math.PI);
    poseBot(frost[2], 6, 0, Math.PI);
    poseBot(frost[3], -9, -6, Math.PI * 0.75);
    poseBot(frost[4], 10, -5, Math.PI * 1.25);
    settle(10);
    // Fire a burst at the mid bot: three torso hits drop it, for the killfeed.
    // The lane is clear of the mid wall from here, so the rounds reach the bot.
    for (let round = 0; round < 3; round += 1) {
      aimAt(new THREE.Vector3(-4, 1.2, -1));
      shoot(0);
      settle(6);
    }
    frost[0].group.rotation.x = -1.45; // the downed bot lies where the burst dropped it
    aimAt(new THREE.Vector3(-4, 1.2, -1));
    hud.setTimer(84, false);
    hud.setScore(2, 1, 3);
    hud.setMoney(S.money);
    hud.setHealth(100);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def.name);
  } else if (name === 'buy') {
    game.startMatch();
    S.round = 3;
    S.score.ember = 1;
    S.score.frost = 1;
    S.money = 4350;
    resetPositions();
    body.yaw = 0;
    settle(10);
    aimAt(new THREE.Vector3(0, 1.6, -8));
    hud.setScore(1, 1, 3);
    hud.setMoney(4350);
    hud.showBuy(4350, owned);
    buyMenuOpen = true;
  } else if (name === 'end') {
    game.startMatch();
    S.round = 4;
    S.score.ember = 2;
    S.score.frost = 1;
    game.startRound();
    resetPositions();
    body.position.set(-10, 0, -6);
    const frost = bots.bots.filter((b) => b.team === 'frost');
    poseBot(frost[0], -13, -9, Math.PI * 0.5);
    bots.damage(frost[0], 500, 'torso');
    frost[0].group.rotation.x = -1.45;
    const ember = bots.bots.filter((b) => b.team === 'ember');
    poseBot(ember[0], -11, -7, 0.4);
    poseBot(ember[1], -8, -4, 0.2);
    settle(10);
    aimAt(new THREE.Vector3(-14, 1.2, -11));
    game.endRound('ember', 'Charge detonated at Site A');
    hud.showOverlay('roundEnd', { win: true, reason: 'Charge detonated at Site A' });
    hud.setScore(3, 1, 4);
    hud.setMoney(S.money);
  }
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def.name);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__game = {
  state: S, game, bots, player, weapon, input, hud, world,
  shoot, finishRound, beginMatch, beginLive, advanceRound, throwSmoke,
  buyWeapon, buySmoke, equipWeapon, step, damagePlayer,
};

// --- boot -------------------------------------------------------------------
bots.init(SPAWNS);
syncCamera();
hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def.name);
hud.setHealth(health);
hud.setMoney(S.money);
hud.setScore(0, 0, 1);
hud.setTimer(BUY_SECONDS, false);
hud.showOverlay('start');
if (shot) runShot(shot);
else requestAnimationFrame(frame);
