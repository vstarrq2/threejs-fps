// Sound, synthesised with WebAudio only: no audio files, no network. A noise buffer
// shared by every percussive sound, an oscillator for beeps and stingers, and a master
// gain the game can mute. Everything is created lazily on the first user gesture, so
// the page never tries to play before the browser allows it.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) return true;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const length = Math.floor(ctx.sampleRate * 0.5);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function resume() {
    if (ensure() && ctx.state === 'suspended') ctx.resume();
  }

  function noise(duration, filterFreq, gain, type = 'lowpass') {
    if (!ensure()) return;
    const time = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, time);
    amp.gain.exponentialRampToValueAtTime(0.001, time + duration);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    source.start(time, Math.random() * 0.3, duration);
  }

  function tone(freq, duration, gain, type = 'sine', slideTo = 0) {
    if (!ensure()) return;
    const time = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, time + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, time);
    amp.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(amp);
    amp.connect(master);
    osc.start(time);
    osc.stop(time + duration);
  }

  function delayed(delay, fn) {
    if (!ensure()) return;
    setTimeout(fn, delay * 1000);
  }

  return {
    resume,
    shot(kind) {
      if (kind === 'sniper') {
        noise(0.28, 900, 0.9);
        tone(160, 0.22, 0.5, 'square', 55);
      } else if (kind === 'shotgun') {
        noise(0.22, 700, 0.9);
        tone(120, 0.18, 0.5, 'square', 45);
      } else if (kind === 'smg') {
        noise(0.09, 2400, 0.45);
        tone(220, 0.07, 0.25, 'square', 90);
      } else if (kind === 'pistol') {
        noise(0.11, 1800, 0.5);
        tone(200, 0.08, 0.3, 'square', 80);
      } else {
        noise(0.14, 1400, 0.7);
        tone(180, 0.1, 0.4, 'square', 60);
      }
    },
    enemyShot(distance) {
      const gain = Math.max(0.08, 0.6 - distance * 0.012);
      noise(0.12, 1200, gain);
    },
    dryFire() {
      tone(1400, 0.03, 0.15, 'square');
    },
    reload() {
      tone(500, 0.04, 0.2, 'square');
      delayed(0.35, () => tone(700, 0.04, 0.2, 'square'));
      delayed(0.7, () => tone(900, 0.04, 0.25, 'square'));
    },
    step() {
      noise(0.05, 500, 0.12);
    },
    hit() {
      tone(1200, 0.05, 0.25, 'sine');
    },
    kill() {
      tone(880, 0.07, 0.3, 'sine');
      delayed(0.08, () => tone(1320, 0.1, 0.3, 'sine'));
    },
    hurt() {
      tone(140, 0.15, 0.4, 'sawtooth', 70);
    },
    plantBeep() {
      tone(880, 0.09, 0.3, 'sine');
    },
    plantDone() {
      tone(660, 0.12, 0.35, 'sine');
      delayed(0.12, () => tone(990, 0.2, 0.35, 'sine'));
    },
    explosion() {
      noise(1.4, 220, 1.0);
      tone(70, 1.2, 0.8, 'sine', 30);
    },
    buy() {
      tone(660, 0.06, 0.25, 'sine');
      delayed(0.07, () => tone(990, 0.08, 0.25, 'sine'));
    },
    roundWin() {
      const notes = [523, 659, 784, 1047];
      notes.forEach((freq, i) => delayed(i * 0.13, () => tone(freq, 0.22, 0.3, 'triangle')));
    },
    roundLose() {
      const notes = [392, 330, 262];
      notes.forEach((freq, i) => delayed(i * 0.16, () => tone(freq, 0.28, 0.3, 'triangle')));
    },
  };
}
