// The DOM HUD: crosshair, hit marker, health, ammo, money, round timer, score,
// killfeed, bomb banner, buy menu and the overlay panels. It never touches the
// simulation; main.js pushes numbers in and reads callbacks out. Every setter skips
// work when its value did not change.
import { WEAPONS, WEAPON_ORDER, SMOKE_PRICE } from './weapons.js';

const BUY_ITEMS = [
  { key: '1', id: 'rifle', label: 'VK-47 Rifle', price: WEAPONS.rifle.price },
  { key: '2', id: 'smg', label: 'Raptor-9 SMG', price: WEAPONS.smg.price },
  { key: '3', id: 'sniper', label: 'Longbow .50', price: WEAPONS.sniper.price },
  { key: '4', id: 'shotgun', label: 'Breacher-12', price: WEAPONS.shotgun.price },
  { key: '5', id: 'smoke', label: 'Smoke grenade', price: SMOKE_PRICE },
];

export function createHud() {
  const el = (id) => document.getElementById(id);
  const overlay = el('overlay');
  const title = el('overlay-title');
  const copy = el('overlay-copy');
  const play = el('play');
  const ammo = el('ammo');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const weaponName = el('weapon-name');
  const healthFill = el('health-fill');
  const healthValue = el('health-value');
  const moneyValue = el('money-value');
  const timerValue = el('timer-value');
  const scoreEmber = el('score-ember');
  const scoreFrost = el('score-frost');
  const roundValue = el('round-value');
  const killfeed = el('killfeed');
  const banner = el('banner');
  const bannerText = el('banner-text');
  const crosshair = el('crosshair');
  const hitmarker = el('hitmarker');
  const buyMenu = el('buy-menu');
  const buyMoney = el('buy-money');
  const buyItems = el('buy-items');
  const plantBar = el('plant-bar');
  const plantFill = el('plant-fill');
  const plantLabel = el('plant-label');
  let hitTimer = 0;
  let last = {};
  let playHandler = null;

  for (const item of BUY_ITEMS) {
    const row = document.createElement('div');
    row.className = 'buy-row';
    row.dataset.id = item.id;
    row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-label">${item.label}</span><span class="buy-price">$${item.price}</span>`;
    row.addEventListener('click', () => buyHandler && buyHandler(item.id));
    buyItems.appendChild(row);
  }
  let buyHandler = null;

  function setText(node, value, key) {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = value;
  }

  return {
    setAmmo(mag, reserve, name) {
      setText(ammoMag, String(mag), 'mag');
      setText(ammoReserve, `/ ${reserve}`, 'reserve');
      setText(weaponName, name, 'weapon');
      ammo.classList.toggle('empty', mag === 0);
    },
    setHealth(value) {
      const pct = Math.max(0, Math.round(value));
      if (last.health === pct) return;
      last.health = pct;
      healthFill.style.width = `${pct}%`;
      healthValue.textContent = String(pct);
      healthFill.classList.toggle('low', pct <= 30);
    },
    setMoney(value) {
      setText(moneyValue, `$${value}`, 'money');
      setText(buyMoney, `$${value}`, 'buyMoney');
    },
    setTimer(seconds, bomb) {
      const total = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
      setText(timerValue, text, 'timer');
      timerValue.classList.toggle('bomb', !!bomb);
    },
    setScore(ember, frost, round) {
      setText(scoreEmber, String(ember), 'se');
      setText(scoreFrost, String(frost), 'sf');
      setText(roundValue, `ROUND ${round}`, 'round');
    },
    setSpread(gapPx) {
      crosshair.style.setProperty('--gap', `${gapPx.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    killfeed(killer, victim, headshot) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.innerHTML = `<b>${killer}</b> <span>${headshot ? '◉' : '✕'}</span> <b>${victim}</b>`;
      killfeed.prepend(row);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => row.remove(), 6000);
    },
    banner(text, kind) {
      bannerText.textContent = text;
      banner.className = kind ? `show ${kind}` : '';
    },
    hideBanner() {
      banner.className = '';
    },
    setPlant(label, progress) {
      if (progress <= 0) {
        plantBar.hidden = true;
        return;
      }
      plantBar.hidden = false;
      plantLabel.textContent = label;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    showBuy(money, owned) {
      buyMenu.hidden = false;
      this.setMoney(money);
      for (const row of buyItems.children) {
        const id = row.dataset.id;
        const ownedNow = id === 'smoke' ? owned.smoke > 0 : owned.weapons.includes(id);
        row.classList.toggle('owned', ownedNow);
        const item = BUY_ITEMS.find((entry) => entry.id === id);
        row.classList.toggle('poor', money < item.price && !ownedNow);
      }
    },
    hideBuy() {
      buyMenu.hidden = true;
    },
    showOverlay(mode, data = {}) {
      const copyText = {
        start: ['DUSK YARD', 'A tactical round-based FPS in a dusk industrial yard. Plant the charge at Site A or B, or wipe the Frost team. Click to play.', 'Click to play'],
        paused: ['DUSK YARD', 'Paused. Click to resume.', 'Click to resume'],
        dead: ['You are down', 'Spectating a teammate until the round ends.', 'Keep watching'],
        roundEnd: [data.win ? 'ROUND WON' : 'ROUND LOST', data.reason || '', 'Next round'],
        matchEnd: [data.win ? 'MATCH WON' : 'MATCH LOST', `Final score Ember ${data.ember} — ${data.frost} Frost.`, 'Play again'],
      }[mode];
      if (!copyText) return;
      title.textContent = copyText[0];
      copy.textContent = copyText[1];
      play.textContent = copyText[2];
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      playHandler = handler;
      play.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyHandler = handler;
    },
  };
}
