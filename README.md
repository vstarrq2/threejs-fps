# DUSK YARD — a three.js tactical FPS

![threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)
![rank](https://make.fun/badge/threejs-fps-02/vstarrq2/threejs-fps/rank.svg)
![reward](https://make.fun/badge/threejs-fps-02/vstarrq2/threejs-fps/reward.svg)

A round-based tactical FPS in the style Counter-Strike made famous, set in an
original dusk industrial yard: two lanes, mid, and two bomb sites. Five Ember
attackers (you + four bots) against five Frost defenders. Plant the charge at
Site A or B, or wipe the other team. Money earned each round buys rifles, SMGs,
a sniper, a shotgun and smoke grenades in the buy menu between rounds.

Made for the [threejs-fps-02 bounty on make.fun](https://make.fun/bounty/threejs-fps-02).

## How it plays

- **First person:** pointer-lock mouse look, WASD movement with acceleration,
  crouch (Ctrl/C), jump (Space), collision with the map.
- **Gunplay:** hitscan raycast against bodies with headshot bonus damage, recoil
  and spread that punish firing on the move — stopping to aim pays. Every weapon
  fires, reloads (R) and runs out of ammunition.
- **Tactics:** plant the charge (hold E at a site), defend it, or defuse. Bots
  follow nav-graph routes through the map, hold angles, and react to sight and
  sound. Smoke grenades (G) block sight, not bullets.
- **Rounds:** buy phase, 100-second rounds, first to 5 takes the match. HUD
  shows health, ammunition, money, round timer and score.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome.
