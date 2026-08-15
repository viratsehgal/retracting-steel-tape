/* Retracting steel tape measure — yellow blade, black case, imperial + metric graduations.
   The whole tool sits at the centre of the canvas and turns slowly on its own axis.
   Drag anywhere to pull the blade out; release to let it snap back. */

const canvas = document.getElementById('tape');
const ctx = canvas.getContext('2d');

/* ---------- scale ---------- */

const BLADE_W = 56;          // blade width in px
const CASE_W = 158;
const CASE_H = 116;
const REACH_IN = 15;         // target inches visible at full extension (sets tick spacing)

const MOUTH = CASE_W / 2 - 4; // blade exits here, measured from case centre

let W = 0, H = 0, cx = 0, cy = 0;
let PPI = 40;                // pixels per inch — derived from the viewport
let PPCM = PPI / 2.54;       // pixels per centimetre
let PPMM = PPCM / 10;
let inStep = 1;              // finest imperial division drawn, in sixteenths
let mmStep = 1;              // finest metric division drawn, in millimetres
let cmLabelStep = 1;         // label every n-th centimetre
let inFont = '700 12px Helvetica, Arial, sans-serif';
let cmFont = '600 10px Helvetica, Arial, sans-serif';

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx = W / 2;
  cy = H / 2;

  // tick spacing — decoupled from how far the blade can physically reach
  const refReach = Math.min(W, H) / 2 - MOUTH;
  PPI = Math.max(28, Math.min(52, refReach / REACH_IN));
  PPCM = PPI / 2.54;
  PPMM = PPCM / 10;

  // thin out the graduations rather than let them collapse into a solid bar
  inStep = PPI / 16 >= 2.2 ? 1 : (PPI / 8 >= 2.2 ? 2 : 4);
  mmStep = PPMM >= 1.6 ? 1 : 5;
  cmLabelStep = PPCM >= 13 ? 1 : (PPCM >= 7 ? 2 : 5);
  inFont = '700 ' + (PPI >= 26 ? 12 : 10) + 'px Helvetica, Arial, sans-serif';
  cmFont = '600 ' + (PPCM >= 10 ? 10 : 9) + 'px Helvetica, Arial, sans-serif';

  // PPI just moved, so the last length is no longer comparable in inches
  audioLen = bladeLen;
  bladeVel = 0;
}

/* ---------- animation state ---------- */

const ROT_SPEED = 0.19;      // radians per second
const RETRACT_DUR = 0.7;

let angle = -0.35;           // heading of the blade, radians
let angOff = 0;              // recoil spring offset
let angVel = 0;
let bladeLen = 0;            // blade length in px
let bladeLenFrom = 0;        // length when retract began
let retracting = false;
let retractT = 0;
let dragging = false;
let flipText = false;
let last = 0;

// The spring keeps pulling all the way home, so the blade is travelling at its
// fastest when it arrives — that rising rush into the snap is what the ear reads
// as a tape retracting.
const RETRACT_CURVE = 1.6;
const retractEase = (p) => Math.pow(p, RETRACT_CURVE);

function startRetract() {
  retracting = true;
  retractT = 0;
  bladeLenFrom = bladeLen;
}

/* ---------- audio ----------
   The blade noise is driven from the blade's real velocity every frame instead of
   being pre-baked at release. Three looping noise voices carry the body of the
   sound and a stream of short grains carries the chatter, so the rattle thins out
   on its own as the spring runs down — and stops dead the instant you catch the
   blade mid-retract. */

// Grains are scheduled per inch of travel, so density follows the blade for free.
// A hard retract peaks near 35 in/sec, which puts the rattle around 140 hits a
// second — dense enough to read as steel, sparse enough to stay granular.
const CHATTER_PER_IN = 4;
const CHATTER_PER_FRAME = 4; // ceiling so a stutter can't fire a burst
const V_REF = 55;            // inches/sec treated as full speed

// Detents the blade steps over as it is drawn off the drum. Evenly spaced along
// the blade, unlike the chatter, which is what makes it read as a mechanism
// rather than as noise. A hand pull runs 2–12 in/sec, so PULL_REF scales the
// ratchet across the speeds a hand actually produces.
const RATCHET_PER_IN = 14;
const RATCHET_PER_FRAME = 5;
const PULL_REF = 12;

const CLOSE_SAMPLE = 'sounds/tape-close.wav';

let actx = null;
let bus = null;              // every voice lands here → compressor → out
let noiseBuf = null;
let closeBuf = null;         // the recorded close, once it has decoded
let scrape = null;           // blade sliding through the mouth of the case
let whir = null;             // coil spinning on the drum
let body = null;             // hollow rumble of the plastic case
let chatterPhase = 0;
let ratchetPhase = 0;
let audioLen = 0;            // blade length at the previous audio update
let bladeVel = 0;            // smoothed blade speed, inches per second

// one looping noise voice: shared noise table → bandpass → gain
function loopVoice(freq, q, rate) {
  const src = actx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  src.playbackRate.value = rate;
  const filter = actx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = actx.createGain();
  gain.gain.value = 0;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(bus);
  src.start();
  return { filter, gain };
}

function initAudio() {
  if (actx) {
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  actx = new AC();

  // One shared noise table. Every voice and every grain reads it at a random
  // offset and rate, so no two hits share a timbre and nothing allocates a
  // buffer mid-animation.
  const n = Math.floor(actx.sampleRate * 2);
  noiseBuf = actx.createBuffer(1, n, actx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    lp = lp * 0.72 + white * 0.28;     // pink-ish tilt reads as metal, not hiss
    d[i] = lp * 1.5 + white * 0.4;
  }

  const comp = actx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.ratio.value = 6;
  comp.attack.value = 0.002;
  comp.release.value = 0.14;
  const out = actx.createGain();
  out.gain.value = 0.8;
  comp.connect(out);
  out.connect(actx.destination);
  bus = comp;

  scrape = loopVoice(1400, 0.8, 1);
  whir = loopVoice(300, 6, 0.85);
  body = loopVoice(130, 3.5, 0.7);

  // A real tape closing, recorded off the tool itself and trimmed to the impact.
  // Until it lands — or if it cannot be fetched, e.g. straight off file:// — the
  // synthesised clank stands in, so the page is never silent waiting on a file.
  fetch(CLOSE_SAMPLE)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
    .then((b) => actx.decodeAudioData(b))
    .then((buf) => { closeBuf = buf; })
    .catch(() => { closeBuf = null; });

  return actx;
}

// short metallic transient, cut from the shared noise table
function metalClick(when, gain, freq, decay) {
  const src = actx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.7 + Math.random() * 1.2;
  const bp = actx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 5;
  const g = actx.createGain();
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.0008, when + decay);
  src.connect(bp);
  bp.connect(g);
  g.connect(bus);
  src.start(when, Math.random() * 1.8, decay + 0.02);
  src.stop(when + decay + 0.02);
}

// one detent of the ratchet — tight, tonal and near enough identical every time,
// so a run of them sounds like a mechanism stepping
function ratchetTick(when, amp) {
  const src = actx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 1.4 + Math.random() * 0.4;
  const bp = actx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2700 * (0.92 + Math.random() * 0.16);
  bp.Q.value = 9;
  const g = actx.createGain();
  const dur = 0.005;
  g.gain.setValueAtTime(amp * (0.85 + Math.random() * 0.3), when);
  g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(bus);
  src.start(when, Math.random() * 1.8, dur + 0.02);
  src.stop(when + dur + 0.02);
}

// one impact of the blade edge against the case — randomised so a run of them
// reads as steel chattering rather than a machine gun
function chatterGrain(when, amp, v) {
  const src = actx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.6 + Math.random() * 1.6;
  const bp = actx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1300 + Math.random() * (2000 + 3600 * v);
  bp.Q.value = 2 + Math.random() * 6;
  const g = actx.createGain();
  const dur = 0.006 + Math.random() * 0.018;
  g.gain.setValueAtTime(amp, when);
  g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(bus);
  src.start(when, Math.random() * 1.8, dur + 0.02);
  src.stop(when + dur + 0.02);
}

// Called once per frame with the current blade length, whether the blade is
// being dragged out or springing back.
function updateBladeAudio(len, dt) {
  if (!actx || actx.state !== 'running' || dt <= 0) {
    audioLen = len;
    return;
  }

  const delta = len - audioLen;
  audioLen = len;
  const raw = Math.abs(delta) / dt / PPI;              // inches per second
  bladeVel += (raw - bladeVel) * Math.min(1, dt * 26); // smooth out pointer jitter

  const v = Math.min(1, bladeVel / V_REF);
  const t = actx.currentTime;
  const glide = 0.03;

  // blade sliding through the mouth — brighter and louder the faster it runs
  scrape.gain.gain.setTargetAtTime(0.16 * Math.pow(v, 0.75), t, glide);
  scrape.filter.frequency.setTargetAtTime(900 + 3600 * v, t, glide);

  // the coil picking up speed on the drum
  whir.gain.gain.setTargetAtTime(0.2 * Math.pow(v, 1.15), t, glide);
  whir.filter.frequency.setTargetAtTime(170 + 640 * v, t, glide);

  // case resonating with it
  body.gain.gain.setTargetAtTime(0.12 * Math.pow(v, 1.4), t, glide);

  // Chatter is scheduled per inch travelled, not per second, so its density
  // follows the blade on its own — dense while it flies, sparse as it slows.
  chatterPhase += Math.abs(delta) / PPI * CHATTER_PER_IN;
  for (let i = 0; i < CHATTER_PER_FRAME && chatterPhase >= 1; i++) {
    chatterPhase -= 1;
    chatterGrain(t + Math.random() * dt, (0.05 + 0.26 * v) * (0.5 + Math.random() * 0.5), v);
  }
  // drop any backlog rather than paying it off as a burst on later frames
  if (chatterPhase > 1) chatterPhase = 1;

  // Drawing the blade out steps it over the return mechanism. Evenly spaced per
  // inch, so the tick rate rises and falls with the pull. Winding back in is
  // buried under the whir, so this only fires on the way out.
  if (delta > 0) {
    const pull = Math.min(1, bladeVel / PULL_REF);
    ratchetPhase += delta / PPI * RATCHET_PER_IN;
    for (let i = 0; i < RATCHET_PER_FRAME && ratchetPhase >= 1; i++) {
      ratchetPhase -= 1;
      ratchetTick(t + Math.random() * dt, 0.05 + 0.1 * pull);
    }
    if (ratchetPhase > 1) ratchetPhase = 1;
  } else {
    ratchetPhase = 0;
  }
}

// Struck steel rings on inharmonic modes — these ratios are what separates metal
// from a tuned note. Higher modes carry less energy and die first.
const CLANK_MODES = [
  { ratio: 1.00, gain: 1.00, decay: 0.40 },
  { ratio: 1.73, gain: 0.70, decay: 0.30 },
  { ratio: 2.41, gain: 0.52, decay: 0.23 },
  { ratio: 3.14, gain: 0.36, decay: 0.16 },
  { ratio: 4.28, gain: 0.24, decay: 0.11 },
  { ratio: 5.67, gain: 0.15, decay: 0.075 },
];

// One strike on the case. The modes are fixed by the geometry of the tool, so a
// harder landing does not move their pitch — it excites more of the high modes,
// rings longer and hits louder. That is the difference between a tick and a clank.
function clank(t, hit, level) {
  const base = 760 * (0.95 + Math.random() * 0.1);   // never the same twice
  CLANK_MODES.forEach((m, i) => {
    const excite = i === 0 ? 1 : Math.pow(hit, 0.3 + i * 0.28);
    const peak = 0.14 * level * m.gain * excite;
    if (peak < 0.0015) return;
    const hz = base * m.ratio * (0.995 + Math.random() * 0.01);
    const decay = m.decay * (0.45 + 0.65 * hit) * (0.85 + Math.random() * 0.3);
    const o = actx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(hz, t);
    o.frequency.exponentialRampToValueAtTime(hz * 0.985, t + decay);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0006, t + decay);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + decay + 0.05);
  });
}

// The recording is one fixed strike at one intensity, so the range has to be
// shaped on the way out. A light close is quieter, duller and cut short before
// it can ring; a hard one runs the sample out in full. Same idea as the
// synthesised path — intensity changes brightness and ring, not pitch.
function recordedClose(t, hit, level) {
  const src = actx.createBufferSource();
  src.buffer = closeBuf;
  // barely off nominal, just so two closes in a row are not identical
  src.playbackRate.value = 0.98 + hit * 0.04 + (Math.random() - 0.5) * 0.03;

  const lp = actx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900 + 11000 * Math.pow(hit, 0.7);
  lp.Q.value = 0.6;

  const g = actx.createGain();
  const ring = 0.05 + 0.15 * hit;
  g.gain.setValueAtTime(0.5 * level, t);
  g.gain.setValueAtTime(0.5 * level, t + ring * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0008, t + ring + 0.03);

  src.connect(lp);
  lp.connect(g);
  g.connect(bus);
  src.start(t);
  src.stop(t + closeBuf.duration + 0.05);
}

// stand-in for the recording: struck-metal modes, a contact transient and a
// bounce, all scaled the same way
function synthClose(t, hit, level) {
  metalClick(t, 0.16 * level, 3200 + 2200 * hit, 0.012 + 0.016 * hit);
  metalClick(t + 0.004, 0.09 * level, 2000 + 900 * hit, 0.03 + 0.03 * hit);
  clank(t, hit, level);

  // hook bouncing once in the mouth — only a hard landing does that
  if (hit > 0.4) {
    const bounce = t + 0.035 + Math.random() * 0.03;
    metalClick(bounce, 0.05 * level, 3600, 0.012);
    clank(bounce, hit * 0.55, level * 0.3);
  }

  // blade settling in the mouth after a hard arrival
  const settles = Math.round(hit * 3);
  for (let i = 0; i < settles; i++) {
    chatterGrain(t + 0.02 + Math.random() * 0.09, 0.05 * level * Math.random(), 0.3);
  }
}

// hook slamming into the mouth at the end of the run;
// hit is 0..1 — how far the blade had been pulled out
function playHomeSnap(hit) {
  if (!actx || actx.state !== 'running') return;
  const t = actx.currentTime;
  hit = Math.max(0, Math.min(1, hit));
  const level = 0.25 + 0.75 * hit;

  // cut the running voices dead — the blade has stopped
  scrape.gain.gain.setTargetAtTime(0, t, 0.01);
  whir.gain.gain.setTargetAtTime(0, t, 0.02);
  body.gain.gain.setTargetAtTime(0, t, 0.03);
  bladeVel = 0;
  chatterPhase = 0;
  ratchetPhase = 0;

  if (closeBuf) recordedClose(t, hit, level);
  else synthClose(t, hit, level);

  // Dead weight of the case body. The recording carries its own thump, and a
  // phone mic gets little of it, so this sits underneath rather than on top.
  const sub = closeBuf ? 0.45 : 1;
  const thud = actx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(150, t);
  thud.frequency.exponentialRampToValueAtTime(38, t + 0.1 + 0.06 * hit);
  const thudGain = actx.createGain();
  thudGain.gain.setValueAtTime(sub * (0.1 + 0.22 * hit), t);
  thudGain.gain.exponentialRampToValueAtTime(0.0008, t + 0.12 + 0.06 * hit);
  thud.connect(thudGain);
  thudGain.connect(bus);
  thud.start(t);
  thud.stop(t + 0.2);
}

// requestAnimationFrame stops while the tab is hidden, which would leave the
// looping voices droning at whatever gain they held. Park the whole graph.
document.addEventListener('visibilitychange', () => {
  if (!actx) return;
  if (document.hidden) {
    actx.suspend();
  } else {
    actx.resume();
    audioLen = bladeLen;
    bladeVel = 0;
    chatterPhase = 0;
    ratchetPhase = 0;
  }
});

function step(dt) {
  if (!dragging) {
    angle += ROT_SPEED * dt;

    if (retracting) {
      retractT += dt;
      bladeLen = bladeLenFrom * (1 - retractEase(Math.min(1, retractT / RETRACT_DUR)));
      if (retractT >= RETRACT_DUR) {
        bladeLen = 0;
        angVel += 4.2 * Math.min(1, bladeLenFrom / 400);
        retracting = false;
        updateBladeAudio(bladeLen, dt);
        // how hard it lands is how far it was pulled: a couple of inches ticks,
        // a full pull clanks
        playHomeSnap(bladeLenFrom / PPI / REACH_IN);
        return finish(dt);
      }
    } else {
      bladeLen = 0;
    }
  }

  updateBladeAudio(bladeLen, dt);
  return finish(dt);
}

// damped spring for the recoil kick, then the heading the tool is drawn at
function finish(dt) {
  angVel += (-90 * angOff - 11 * angVel) * dt;
  angOff += angVel * dt;

  const world = angle + angOff;
  flipText = Math.cos(world) < 0;
  return world;
}

/* ---------- drawing helpers ---------- */

function roundRect(x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Text that stays upright no matter where the tape is pointing.
function label(x, y, text, font, color) {
  ctx.save();
  ctx.translate(x, y);
  if (flipText) ctx.rotate(Math.PI);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function tick(x, from, len, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, from);
  ctx.lineTo(x, from + len);
  ctx.stroke();
}

/* ---------- the blade ---------- */

const bladeTop = -BLADE_W / 2;
const bladeBot = BLADE_W / 2;
const INK = '#141414';
const UNIT_INK = '#8a6a00';
const UNIT_FONT = '700 7px Helvetica, Arial, sans-serif';

function drawBlade(len) {
  // fully retracted, the hook still rests against the mouth of the case
  len = Math.max(len, 20);

  // concave steel: bright down the middle, shaded at both rolled edges
  const g = ctx.createLinearGradient(0, bladeTop, 0, bladeBot);
  g.addColorStop(0.00, '#c98d04');
  g.addColorStop(0.06, '#f0bb10');
  g.addColorStop(0.30, '#ffe377');
  g.addColorStop(0.46, '#ffd93f');
  g.addColorStop(0.72, '#f7c718');
  g.addColorStop(0.94, '#e0a606');
  g.addColorStop(1.00, '#b87f03');

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = g;
  ctx.fillRect(0, bladeTop, len, BLADE_W);
  ctx.restore();

  // rolled edges
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, bladeTop + 0.5);
  ctx.lineTo(len, bladeTop + 0.5);
  ctx.moveTo(0, bladeBot - 0.5);
  ctx.lineTo(len, bladeBot - 0.5);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, bladeTop, len, BLADE_W);
  ctx.clip();
  drawImperial(len);
  drawMetric(len);
  ctx.restore();

  drawHook(len);
}

// Top edge: inches down to sixteenths, feet flagged in red.
function drawImperial(len) {
  const sixteenth = PPI / 16;
  const total = Math.floor(len / sixteenth);

  for (let s = 0; s <= total; s += inStep) {
    const x = len - s * sixteenth;      // zero sits at the hook
    if (x < -1) break;
    let h, w = 1;
    if (s % 16 === 0) { h = 17; w = 1.6; }
    else if (s % 8 === 0) { h = 12; }
    else if (s % 4 === 0) { h = 9.5; }
    else if (s % 2 === 0) { h = 7; }
    else { h = 5; }
    tick(x, bladeTop + 1, h, w, INK);

    if (s % 16 === 0 && s > 0) {
      const inches = s / 16;
      if (inches % 12 === 0) drawFootFlag(x, inches / 12, inches);
      else label(x, bladeTop + 26, String(inches), inFont, INK);
    }
  }

  // unit word printed in the gap between the 1 in and 2 in numerals
  label(len - PPI * 1.5, bladeTop + 26, 'IN', UNIT_FONT, UNIT_INK);
}

// Every whole foot gets the red flag traditional tapes use — or just a red
// numeral when the inch spacing is too tight for the box to fit.
function drawFootFlag(x, feet, inches) {
  tick(x, bladeTop + 1, 17, 2.2, '#c01a1a');

  if (PPI < 19) {
    label(x, bladeTop + 26, String(inches), inFont, '#c01a1a');
    return;
  }

  ctx.save();
  ctx.translate(x, 0);
  if (flipText) ctx.rotate(Math.PI);
  ctx.fillStyle = '#c01a1a';
  roundRect(-13, bladeTop + 18, 26, 17, 3);
  ctx.fill();
  ctx.font = '700 10px Helvetica, Arial, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(feet + 'F', 0, bladeTop + 27);
  ctx.restore();
}

// Bottom edge: centimetres and millimetres.
function drawMetric(len) {
  const total = Math.floor(len / PPMM);
  for (let mm = 0; mm <= total; mm += mmStep) {
    const x = len - mm * PPMM;
    if (x < -1) break;
    let h, w = 1, col = INK;
    if (mm % 10 === 0) { h = 13; w = 1.4; }
    else if (mm % 5 === 0) { h = 8.5; }
    else { h = 4; w = 0.75; col = 'rgba(20,20,20,0.75)'; }
    tick(x, bladeBot - 1 - h, h, w, col);

    if (mm % 10 === 0 && mm > 0 && (mm / 10) % cmLabelStep === 0) {
      label(x, bladeBot - 20, String(mm / 10), cmFont, INK);
    }
  }
  // unit word dropped into whichever centimetre gap is left unlabelled
  label(len - PPCM * (cmLabelStep === 1 ? 2.5 : 3), bladeBot - 20, 'cm', UNIT_FONT, UNIT_INK);
}

// Bent metal end hook.
function drawHook(len) {
  const g = ctx.createLinearGradient(0, bladeTop, 0, bladeBot);
  g.addColorStop(0, '#8e9196');
  g.addColorStop(0.35, '#e3e6ea');
  g.addColorStop(0.55, '#b9bdc3');
  g.addColorStop(1, '#71757a');

  ctx.save();
  ctx.translate(len, 0);
  ctx.fillStyle = g;
  roundRect(-13, bladeTop - 5, 18, BLADE_W + 10, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // rivets
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (const y of [bladeTop + 9, bladeBot - 9]) {
    ctx.beginPath();
    ctx.arc(-6, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ---------- the case ---------- */

function drawCase() {
  const hw = CASE_W / 2;
  const hh = CASE_H / 2;

  // rubber overmould shell
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 9;
  ctx.fillStyle = '#191a1c';
  roundRect(-hw - 7, -hh - 7, CASE_W + 14, CASE_H + 14, 24);
  ctx.fill();
  ctx.restore();

  // blade mouth, sunk into the right edge
  ctx.fillStyle = '#0d0d0e';
  roundRect(hw - 2, -BLADE_W / 2 - 6, 14, BLADE_W + 12, 4);
  ctx.fill();

  // yellow body
  const body = ctx.createLinearGradient(0, -hh, 0, hh);
  body.addColorStop(0, '#ffdf5c');
  body.addColorStop(0.42, '#f8c614');
  body.addColorStop(1, '#dc9c02');
  ctx.fillStyle = body;
  roundRect(-hw, -hh, CASE_W, CASE_H, 17);
  ctx.fill();

  // gloss sweep
  ctx.save();
  roundRect(-hw, -hh, CASE_W, CASE_H, 17);
  ctx.clip();
  const gloss = ctx.createLinearGradient(-hw, -hh, -hw + 40, hh);
  gloss.addColorStop(0, 'rgba(255,255,255,0.55)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(-hw, -hh, CASE_W, hh);

  // black grip boot on the back end
  ctx.fillStyle = '#1c1d1f';
  roundRect(-hw - 4, -hh - 4, 46, CASE_H + 8, 16);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  for (let i = 0; i < 5; i++) ctx.fillRect(-hw + 6, -hh + 16 + i * 17, 30, 5);

  // black band framing the blade slot
  ctx.fillStyle = '#1c1d1f';
  ctx.fillRect(hw - 15, -hh, 15, CASE_H);
  ctx.restore();

  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  roundRect(-hw, -hh, CASE_W, CASE_H, 17);
  ctx.stroke();

  drawNamePlate();
  drawLockLever();

  // case screws
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  for (const [sx, sy] of [[-22, -hh + 14], [-22, hh - 14], [hw - 40, hh - 14]]) {
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(sx - 2, sy);
    ctx.lineTo(sx + 2, sy);
    ctx.stroke();
  }
}

function drawNamePlate() {
  ctx.save();
  if (flipText) ctx.rotate(Math.PI);
  const plate = ctx.createLinearGradient(0, -20, 0, 20);
  plate.addColorStop(0, '#2c2e31');
  plate.addColorStop(1, '#111213');
  ctx.fillStyle = plate;
  roundRect(-34, -21, 74, 42, 21);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8c614';
  ctx.font = '700 11px Helvetica, Arial, sans-serif';
  ctx.fillText('STEEL', 3, -8);
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '600 7px Helvetica, Arial, sans-serif';
  ctx.fillText('TAPE RULE', 3, 3);
  ctx.fillStyle = '#9a9a9a';
  ctx.font = '600 6px Helvetica, Arial, sans-serif';
  ctx.fillText('16 FT · 5 M', 3, 13);
  ctx.restore();
}

function drawLockLever() {
  const hh = CASE_H / 2;
  const lever = ctx.createLinearGradient(0, -hh - 14, 0, -hh + 10);
  lever.addColorStop(0, '#4a4d52');
  lever.addColorStop(0.5, '#2a2c2f');
  lever.addColorStop(1, '#151618');
  ctx.fillStyle = lever;
  roundRect(4, -hh - 15, 44, 26, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  for (let i = 0; i < 5; i++) ctx.fillRect(10 + i * 7, -hh - 10, 3, 12);
}

/* ---------- readout ---------- */

function drawReadout(len) {
  const inches = len / PPI;
  const feet = Math.floor(inches / 12);
  const remIn = inches - feet * 12;
  const text = inches.toFixed(2) + ' in   ·   ' + (inches * 2.54).toFixed(1) + ' cm   ·   ' +
    feet + "' " + remIn.toFixed(1) + '"';
  ctx.font = '11px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  ctx.fillStyle = '#9a9a9a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, cx, 40);
}

/* ---------- frame ---------- */

function frame(now) {
  const t = now / 1000;
  const dt = Math.min(0.05, last ? t - last : 0.016);
  last = t;

  const world = step(dt);
  const len = bladeLen;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  drawReadout(len);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(world);
  ctx.save();
  ctx.translate(CASE_W / 2 - 4, 0);
  drawBlade(len);
  ctx.restore();
  drawCase();
  ctx.restore();

  requestAnimationFrame(frame);
}

/* ---------- dragging ---------- */

// furthest the blade can reach toward the screen edge in a given direction
function edgeReach(a) {
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const toEdge = Math.min(
    cos > 1e-6 ? W / 2 / cos : Infinity,
    sin > 1e-6 ? H / 2 / sin : Infinity
  );
  return Math.max(0, toEdge - MOUTH);
}

function pointerAngleLen(e) {
  const dx = e.clientX - cx;
  const dy = e.clientY - cy;
  const a = Math.atan2(dy, dx);
  const dist = Math.hypot(dx, dy) - MOUTH;
  const reach = edgeReach(a);
  return { a, len: Math.max(0, Math.min(reach, dist)) };
}

canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  dragging = true;
  retracting = false;
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
  const p = pointerAngleLen(e);
  angle = p.a - angOff;
  bladeLen = p.len;
  // grabbing the blade is not blade travel — don't chatter on the jump to the pointer
  audioLen = p.len;
  bladeVel = 0;
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const p = pointerAngleLen(e);
  angle = p.a - angOff;
  bladeLen = p.len;
});

function release() {
  if (!dragging) return;
  dragging = false;
  canvas.classList.remove('dragging');
  if (bladeLen > 0) startRetract();
}

canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
