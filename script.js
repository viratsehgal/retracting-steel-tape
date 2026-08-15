/* Retracting steel tape measure — yellow blade, black case, imperial + metric graduations.
   The whole tool sits at the centre of the canvas and turns slowly on its own axis.
   Drag anywhere to pull the blade out; release to let it snap back. */

const canvas = document.getElementById('tape');
const ctx = canvas.getContext('2d');

/* ---------- scale ---------- */

const BLADE_W = 56;          // blade width in px
const CASE_W = 158;
const CASE_H = 116;
const REACH_IN = 15;         // inches of blade the animation pulls out (well past the 1 ft mark)

let W = 0, H = 0, cx = 0, cy = 0, maxLen = 300;
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

  // the tool sweeps a full circle, so the blade has to fit inside the shorter axis
  maxLen = Math.max(150, Math.min(W, H) / 2 - CASE_W / 2 - 34);
  PPI = Math.max(16, Math.min(52, maxLen / REACH_IN));
  PPCM = PPI / 2.54;
  PPMM = PPCM / 10;

  // thin out the graduations rather than let them collapse into a solid bar
  inStep = PPI / 16 >= 2.2 ? 1 : (PPI / 8 >= 2.2 ? 2 : 4);
  mmStep = PPMM >= 1.6 ? 1 : 5;
  cmLabelStep = PPCM >= 13 ? 1 : (PPCM >= 7 ? 2 : 5);
  inFont = '700 ' + (PPI >= 26 ? 12 : 10) + 'px Helvetica, Arial, sans-serif';
  cmFont = '600 ' + (PPCM >= 10 ? 10 : 9) + 'px Helvetica, Arial, sans-serif';
}

/* ---------- animation state ---------- */

const ROT_SPEED = 0.19;      // radians per second
const RETRACT_DUR = 0.7;

let angle = -0.35;           // heading of the blade, radians
let angOff = 0;              // recoil spring offset
let angVel = 0;
let ext = 0;                 // 0..1 fraction of maxLen
let extFrom = 0;             // value the current retract started from
let retracting = false;
let retractT = 0;
let dragging = false;
let flipText = false;
let last = 0;

const easeInQuart = (p) => p * p * p * p;

function startRetract() {
  retracting = true;
  retractT = 0;
  extFrom = ext;
}

function step(dt) {
  if (!dragging) {
    angle += ROT_SPEED * dt;

    if (retracting) {
      retractT += dt;
      ext = extFrom * (1 - easeInQuart(Math.min(1, retractT / RETRACT_DUR)));
      if (retractT >= RETRACT_DUR) {
        ext = 0;
        angVel += 4.2 * extFrom;   // the blade slams home and kicks the case
        retracting = false;
      }
    } else {
      ext = 0;
    }
  }

  // damped spring for the recoil kick
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
  const len = ext * maxLen;

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

function pointerAngleLen(e) {
  const dx = e.clientX - cx;
  const dy = e.clientY - cy;
  const dist = Math.hypot(dx, dy) - (CASE_W / 2 - 4);
  return { a: Math.atan2(dy, dx), l: Math.max(0, Math.min(1, dist / maxLen)) };
}

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  retracting = false;
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
  const p = pointerAngleLen(e);
  angle = p.a - angOff;
  ext = p.l;
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const p = pointerAngleLen(e);
  angle = p.a - angOff;
  ext = p.l;
});

function release() {
  if (!dragging) return;
  dragging = false;
  canvas.classList.remove('dragging');
  if (ext > 0) startRetract();
}

canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
