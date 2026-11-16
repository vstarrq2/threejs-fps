// Bots: 5v5, nine of them. Each bot is a body with a head and torso a bullet can hit,
// a nav-graph route, a hold angle, and eyes and ears: it sees enemies in a cone with a
// clear line of sight (smoke blocks it), hears gunfire and turns toward it, and shoots
// in bursts whose hit chance falls with distance and target movement. One attacker bot
// carries the charge and plants if the player is down; defenders rotate to defuse.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { findPath } from './nav.js';

const BOT_SPEED = 3.4;
const BOT_HEALTH = 100;
const VISION_RANGE = 38;
const VISION_HALF_ANGLE = 0.95; // ~54 degrees each side
const HEAR_RADIUS = 26;
const BOT_DAMAGE = 30;
const BOT_HEAD_CHANCE = 0.12;

const NAMES_EMBER = ['Ash', 'Coal', 'Flint', 'Spark'];
const NAMES_FROST = ['Vapor', 'Glacier', 'Mist', 'Hail', 'Rime'];

// Shared geometry and materials: nine bots, one set of assets.
const torsoGeo = new THREE.BoxGeometry(0.52, 0.72, 0.3);
const headGeo = new THREE.SphereGeometry(0.16, 14, 10);
const bandGeo = new THREE.BoxGeometry(0.34, 0.07, 0.34);
const legsGeo = new THREE.BoxGeometry(0.42, 0.62, 0.28);
const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.55);
const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2724'), roughness: 0.8 });
const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8a6a52'), roughness: 0.7 });
const gunMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.3 });
const teamMats = {
  ember: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.65 }),
  frost: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.frost), roughness: 0.65 }),
};

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

function makeBody(scene, team) {
  const group = new THREE.Group();
  const legs = new THREE.Mesh(legsGeo, darkMat);
  legs.position.y = 0.31;
  const torso = new THREE.Mesh(torsoGeo, teamMats[team]);
  torso.position.y = 1.0;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.y = 1.52;
  head.userData.part = 'head';
  const band = new THREE.Mesh(bandGeo, teamMats[team]);
  band.position.y = 1.58;
  const gun = new THREE.Mesh(gunGeo, gunMat);
  gun.position.set(0.2, 1.05, -0.25);
  group.add(legs, torso, head, band, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  scene.add(group);
  return { group, torso, head, gun };
}

export function createBots(scene, colliders) {
  const bots = [];
  const hitMeshes = [];
  const probe = new THREE.Box3();
  const tmp = new THREE.Vector3();

  function spawnBot(team, name, x, z, index) {
    const body = makeBody(scene, team);
    const bot = {
      team, name, index,
      group: body.group, torso: body.torso, head: body.head,
      health: BOT_HEALTH, alive: true,
      yaw: team === 'ember' ? Math.PI : 0,
      pitch: 0, fall: 0,
      mode: 'route', path: [], pathIndex: 0,
      target: null, lastSeen: 0, seenAt: -99,
      burstLeft: 0, nextShotAt: 0, pauseUntil: 0,
      holdNode: null, holdUntil: 0, scanDir: 0,
      channel: null, channelLeft: 0, // 'plant' | 'defuse'
      carrier: false,
      rng: mulberry32(1000 + index * 77),
      visionTimer: index * 0.05,
      speed: BOT_SPEED * (0.9 + (index % 3) * 0.08),
    };
    body.torso.userData.bot = bot;
    body.head.userData.bot = bot;
    body.group.position.set(x, 0, z);
    body.group.rotation.y = bot.yaw;
    hitMeshes.push(body.torso, body.head);
    bots.push(bot);
    return bot;
  }

  function reset(teamSpawns) {
    let ember = 0;
    let frost = 0;
    for (const bot of bots) {
      const spawn = bot.team === 'ember' ? teamSpawns.ember[ember] : teamSpawns.frost[frost];
      if (bot.team === 'ember') ember += 1;
      else frost += 1;
      bot.group.position.set(spawn[0], 0, spawn[1]);
      bot.group.rotation.set(0, bot.team === 'ember' ? Math.PI : 0, 0);
      bot.yaw = bot.team === 'ember' ? Math.PI : 0;
      bot.health = BOT_HEALTH;
      bot.alive = true;
      bot.fall = 0;
      bot.mode = 'route';
      bot.path = [];
      bot.pathIndex = 0;
      bot.target = null;
      bot.channel = null;
      bot.channelLeft = 0;
      bot.burstLeft = 0;
      bot.pauseUntil = 0;
      bot.holdNode = null;
      bot.group.visible = true;
    }
  }

  function init(spawns) {
    if (bots.length > 0) return; // bots are built once; reset() re-poses them each round
    for (let i = 0; i < 4; i += 1) spawnBot('ember', NAMES_EMBER[i], spawns.ember[i][0], spawns.ember[i][1], i);
    for (let i = 0; i < 5; i += 1) spawnBot('frost', NAMES_FROST[i], spawns.frost[i][0], spawns.frost[i][1], 10 + i);
    bots[0].carrier = true; // Ash carries the charge if the player goes down.
  }

  function damage(bot, amount, part) {
    if (!bot.alive) return false;
    bot.health -= amount;
    bot.channel = null;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.fall = 0;
    bot.mode = 'dead';
    bot.target = null;
    return true;
  }

  function overlaps(x, z) {
    probe.min.set(x - 0.3, 0.05, z - 0.3);
    probe.max.set(x + 0.3, 1.7, z + 0.3);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  function walkToward(bot, tx, tz, dt) {
    const dx = tx - bot.group.position.x;
    const dz = tz - bot.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const step = Math.min(dist, bot.speed * dt);
    const nx = bot.group.position.x + (dx / dist) * step;
    const nz = bot.group.position.z + (dz / dist) * step;
    if (!overlaps(nx, nz)) {
      bot.group.position.x = nx;
      bot.group.position.z = nz;
    } else if (!overlaps(nx, bot.group.position.z)) {
      bot.group.position.x = nx;
    } else if (!overlaps(bot.group.position.x, nz)) {
      bot.group.position.z = nz;
    }
    const targetYaw = Math.atan2(-dx, -dz);
    let diff = targetYaw - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += Math.max(-dt * 6, Math.min(dt * 6, diff));
    bot.group.rotation.y = bot.yaw;
    return dist < 0.4;
  }

  function setRoute(bot, tx, tz) {
    bot.path = findPath(bot.group.position.x, bot.group.position.z, tx, tz);
    bot.pathIndex = 0;
    bot.mode = 'route';
  }

  function step(bot, dt, ctx) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.group.rotation.x = -bot.fall * 1.45;
      return;
    }
    const now = ctx.time;
    // Vision runs on a stagger so nine bots do not raycast on the same frame.
    bot.visionTimer -= dt;
    if (bot.visionTimer <= 0) {
      bot.visionTimer = 0.15;
      const seen = ctx.scan(bot);
      if (seen) {
        bot.target = seen;
        bot.seenAt = now;
        bot.mode = 'engage';
        bot.channel = null;
      } else if (bot.target && now - bot.seenAt > 2) {
        bot.target = null;
        if (bot.mode === 'engage') {
          bot.mode = bot.holdNode ? 'hold' : 'route';
          if (bot.mode === 'route' && bot.path.length === 0) assignObjective(bot, ctx);
        }
      }
    }
    // Ears: gunfire nearby turns the bot toward the noise.
    for (const noise of ctx.noises) {
      if (noise.time < now - 0.1) continue;
      const dx = noise.x - bot.group.position.x;
      const dz = noise.z - bot.group.position.z;
      if (dx * dx + dz * dz < HEAR_RADIUS * HEAR_RADIUS && !bot.target) {
        bot.yaw = Math.atan2(-dx, -dz);
        bot.group.rotation.y = bot.yaw;
        if (bot.mode === 'hold') {
          bot.mode = 'route';
          setRoute(bot, noise.x, noise.z);
        }
      }
    }

    if (bot.mode === 'engage' && bot.target) {
      const t = bot.target;
      // The target is gone: drop the engagement instead of shooting a corpse.
      if ((t.isPlayer && !ctx.playerAlive) || (!t.isPlayer && !t.alive)) {
        bot.target = null;
        bot.mode = bot.holdNode ? 'hold' : 'route';
        if (bot.mode === 'route') assignObjective(bot, ctx);
        return;
      }
      const tp = t.isPlayer ? ctx.playerPos : t.group.position;
      const ty = t.isPlayer ? ctx.playerPos.y + (t.crouching ? 1.0 : 1.5) : 1.4;
      const dx = tp.x - bot.group.position.x;
      const dz = tp.z - bot.group.position.z;
      const dist = Math.hypot(dx, dz);
      const dy = ty - 1.4;
      bot.yaw = Math.atan2(-dx, -dz);
      bot.pitch = Math.atan2(dy, dist);
      bot.group.rotation.y = bot.yaw;
      // Strafe a little so a duel is not a statue shoot-out.
      if (bot.rng() < 0.3) {
        const side = bot.rng() < 0.5 ? 1 : -1;
        const sx = Math.cos(bot.yaw) * side * bot.speed * 0.4 * dt;
        const sz = -Math.sin(bot.yaw) * side * bot.speed * 0.4 * dt;
        if (!overlaps(bot.group.position.x + sx, bot.group.position.z + sz)) {
          bot.group.position.x += sx;
          bot.group.position.z += sz;
        }
      }
      if (now >= bot.pauseUntil) {
        if (bot.burstLeft <= 0) {
          bot.burstLeft = 3 + Math.floor(bot.rng() * 3);
          bot.pauseUntil = now + 0.75 + bot.rng() * 0.5;
        } else if (now >= bot.nextShotAt) {
          bot.nextShotAt = now + 0.13;
          bot.burstLeft -= 1;
          ctx.botShoot(bot, t, dist);
        }
      }
      return;
    }

    // Objective channels: planting and defusing are standing still, and damage breaks them.
    if (bot.channel) {
      bot.channelLeft -= dt;
      if (bot.channelLeft <= 0) {
        ctx.channelDone(bot, bot.channel);
        bot.channel = null;
      }
      return;
    }

    if (bot.mode === 'hold') {
      bot.scanDir += dt * 0.5;
      bot.yaw = bot.holdYaw + Math.sin(bot.scanDir) * 0.6;
      bot.group.rotation.y = bot.yaw;
      if (now > bot.holdUntil) assignObjective(bot, ctx);
      return;
    }

    if (bot.mode === 'route') {
      if (bot.pathIndex >= bot.path.length) {
        arrive(bot, ctx);
        return;
      }
      const point = bot.path[bot.pathIndex];
      if (walkToward(bot, point[0], point[1], dt)) bot.pathIndex += 1;
    }
  }

  function arrive(bot, ctx) {
    if (bot.team === 'ember' && ctx.bombPlanted) {
      // Attackers hold ground once the charge is down.
      bot.mode = 'hold';
      bot.holdYaw = bot.yaw;
      bot.holdUntil = ctx.time + 999;
      return;
    }
    if (bot.team === 'frost' && ctx.bombPlanted) {
      // Defenders rotate to the planted bomb; once beside it, they defuse.
      const site = ctx.bombSite;
      const dx = site.x - bot.group.position.x;
      const dz = site.z - bot.group.position.z;
      if (dx * dx + dz * dz < 9) {
        bot.channel = 'defuse';
        bot.channelLeft = 5;
        return;
      }
      setRoute(bot, site.x, site.z);
      bot.defuseTarget = true;
      return;
    }
    if (bot.team === 'ember' && bot.carrier && !ctx.playerAlive && !ctx.bombPlanted) {
      // The carrier plants when the player is down and the site is reached.
      const site = ctx.assignedSite;
      const dx = site.x - bot.group.position.x;
      const dz = site.z - bot.group.position.z;
      if (dx * dx + dz * dz < 9) {
        bot.channel = 'plant';
        bot.channelLeft = 3;
        return;
      }
    }
    // Reached a hold point: hold the angle for a while.
    bot.mode = 'hold';
    bot.holdYaw = bot.yaw;
    bot.holdUntil = ctx.time + 6 + bot.rng() * 6;
  }

  function assignObjective(bot, ctx) {
    if (!ctx.roundLive) return;
    if (bot.team === 'frost') {
      if (ctx.bombPlanted) {
        setRoute(bot, ctx.bombSite.x, ctx.bombSite.z);
        bot.defuseTarget = true;
        return;
      }
      const holds = ['aHold', 'bHold', 'midTop', 'siteA', 'siteB'];
      const node = holds[Math.floor(bot.rng() * holds.length)];
      const pos = ctx.nodePos(node);
      setRoute(bot, pos.x, pos.z);
      bot.holdNode = node;
      return;
    }
    // Ember: two bots push each lane, one goes mid, the carrier follows the called site.
    const site = ctx.assignedSite;
    const roll = bot.rng();
    if (bot.carrier) {
      setRoute(bot, site.x, site.z);
    } else if (roll < 0.4) {
      setRoute(bot, site.x < 0 ? -18.5 : 18.5, -2);
      bot.holdNode = site.x < 0 ? 'aLane2' : 'bLane2';
    } else if (roll < 0.7) {
      setRoute(bot, site.x, site.z);
    } else {
      setRoute(bot, 0, -6);
      bot.holdNode = 'midTop';
    }
  }

  function startRound(ctx) {
    for (const bot of bots) {
      bot.holdNode = null;
      bot.defuseTarget = false;
      assignObjective(bot, ctx);
    }
  }

  return {
    bots, hitMeshes, init, reset, damage, step, startRound, assignObjective,
    aliveCount(team) {
      let count = 0;
      for (const bot of bots) if (bot.team === team && bot.alive) count += 1;
      return count;
    },
  };
}

export { BOT_DAMAGE, BOT_HEAD_CHANCE };
