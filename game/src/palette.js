// The look plan, in one place: dusk in an industrial yard. Warm low sun, cool violet
// shadows, rusted containers against grey concrete. The same names are the CSS custom
// properties in index.html, so the page chrome and the 3D scene share one palette.
export const PALETTE = {
  sky: '#3b3049', // dusk violet sky and fog
  canvas: '#23202b', // page background behind the canvas
  surface: '#3a3a40', // asphalt ground
  concrete: '#6e6a63', // walls and concrete blocks
  hairline: '#2c323a', // dark steel trim
  ink: '#e9e6df', // warm off-white (HUD text, markings)
  muted: '#98a0a8', // cool grey (secondary text)
  accent: '#f0a830', // amber accent (HUD, site markers)
  sun: '#ffb36b', // low warm sun
  rust: '#b4552d', // rusted container
  teal: '#2e7d7b', // painted container
  ochre: '#c08a2d', // ochre container
  olive: '#6b7040', // olive container
  ember: '#ff8c42', // attacker team (Ember)
  frost: '#35c4b5', // defender team (Frost)
  danger: '#e5484d', // damage, bomb, round lost
};

export function shade(name) {
  return PALETTE[name];
}
