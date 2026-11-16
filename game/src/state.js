// The one place state lives: phase, round, score, money, the round timer and the bomb.
// main.js and the bots read it; only its functions change it. Money: a round win pays
// $3250, a loss $1900, a kill $300, a plant $300. First to 5 rounds takes the match.
import { SITES } from './world.js';

export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const BOMB_SECONDS = 40;
export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 5;
export const WIN_ROUNDS = 5;
export const WIN_MONEY = 3250;
export const LOSS_MONEY = 1900;
export const KILL_MONEY = 300;
export const PLANT_MONEY = 300;

export function createState() {
  const state = {
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    round: 1,
    score: { ember: 0, frost: 0 },
    money: 800,
    timer: 0,
    bomb: { planted: false, site: null, timer: 0, defused: false },
    assignedSite: 'A',
    plantProgress: 0,
    defuseProgress: 0,
    lastReason: '',
    playerAlive: true,
    kills: 0,
    deaths: 0,
  };

  function startMatch() {
    state.round = 1;
    state.score.ember = 0;
    state.score.frost = 0;
    state.money = 800;
    state.kills = 0;
    state.deaths = 0;
    state.bomb.planted = false;
    state.bomb.site = null;
    startBuy();
  }

  function startBuy() {
    state.phase = 'buy';
    state.timer = BUY_SECONDS;
    state.bomb.planted = false;
    state.bomb.site = null;
    state.bomb.timer = 0;
    state.bomb.defused = false;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    state.playerAlive = true;
    // Alternate the called site each round so both lanes see play.
    state.assignedSite = state.round % 2 === 1 ? 'A' : 'B';
  }

  function startRound() {
    state.phase = 'live';
    state.timer = ROUND_SECONDS;
  }

  function plant(site) {
    state.bomb.planted = true;
    state.bomb.site = site;
    state.bomb.timer = BOMB_SECONDS;
    state.money += PLANT_MONEY;
  }

  // Returns the winning team, or null when the round goes on.
  function endRound(winner, reason) {
    if (state.phase !== 'live') return null;
    state.phase = 'roundEnd';
    state.timer = 5;
    state.lastReason = reason;
    state.score[winner] += 1;
    if (winner === 'ember') state.money += WIN_MONEY;
    else state.money += LOSS_MONEY;
    state.bomb.planted = false;
    return winner;
  }

  function nextRound() {
    state.round += 1;
    if (state.score.ember >= WIN_ROUNDS || state.score.frost >= WIN_ROUNDS) {
      state.phase = 'matchEnd';
      state.timer = 0;
      return;
    }
    startBuy();
  }

  function sitePosition(key) {
    const site = SITES[key];
    return { x: site.x, z: site.z };
  }

  return {
    state,
    startMatch,
    startBuy,
    startRound,
    plant,
    endRound,
    nextRound,
    sitePosition,
  };
}
