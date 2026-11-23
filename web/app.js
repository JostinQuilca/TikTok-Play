/**
 * TikTok Plotter 3D Live — app.js
 * 3D XY Plotter on Wooden Table with Curved Paper using Three.js
 */

'use strict';

// ============================================================
// 1. SCENE SCALING (Auto-fit 1080x1920 with CSS variable)
// ============================================================
function scaleScene() {
  const scaleX = window.innerWidth  / 1080;
  const scaleY = window.innerHeight / 1920;
  const scale  = Math.min(scaleX, scaleY);
  document.documentElement.style.setProperty('--scene-scale', scale);
}
scaleScene();
window.addEventListener('resize', scaleScene);

// ============================================================
// 2. CONFIGURATION
// ============================================================
let CONFIG = {
  print_speed_ms: 2200,
  paper_scroll_speed_ms: 900,
  audio_volume: 0.6,
  gift_tiers: {
    print: { label: 'Rose → Print (1x1)', emoji: '🌹', frame_color: '#c4a882' },
    big:   { label: 'Donut → Big (2x2)',   emoji: '🍩', frame_color: '#ff8c00' },
    vip:   { label: '100+ → SUPER VIP',    emoji: '👑', frame_color: '#ffd700' },
  }
};

async function fetchConfig() {
  try {
    const r = await fetch('/api/config');
    if (r.ok) {
      const data = await r.json();
      CONFIG = { ...CONFIG, ...data };
      updateLegend();
    }
  } catch (_) {}
}

function updateLegend() {
  const tiers = CONFIG.gift_tiers || {};
  if (tiers.print) document.querySelector('#legend-print .legend-text').textContent = tiers.print.label;
  if (tiers.big)   document.querySelector('#legend-big .legend-text').textContent   = tiers.big.label;
  if (tiers.vip)   document.querySelector('#legend-vip .legend-text').textContent   = tiers.vip.label;
}

// ============================================================
// 3. AUDIO PROCEDURAL (Web Audio API - Stepper & FX)
// ============================================================
let audioCtx = null;
let isMuted = false;
let stepperOsc = null;
let stepperGain = null;
let stepperNoiseGain = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    initStepperSynth();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function initStepperSynth() {
  if (!audioCtx) return;
  try {
    stepperOsc = audioCtx.createOscillator();
    stepperOsc.type = 'sawtooth';
    stepperOsc.frequency.setValueAtTime(160, audioCtx.currentTime);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(450, audioCtx.currentTime);
    filter.Q.setValueAtTime(3.5, audioCtx.currentTime);

    stepperGain = audioCtx.createGain();
    stepperGain.gain.setValueAtTime(0.0001, audioCtx.currentTime);

    const bufferSize = audioCtx.sampleRate * 2;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = audioCtx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(1200, audioCtx.currentTime);
    noiseFilter.Q.setValueAtTime(2.0, audioCtx.currentTime);

    stepperNoiseGain = audioCtx.createGain();
    stepperNoiseGain.gain.setValueAtTime(0.0001, audioCtx.currentTime);

    whiteNoise.connect(noiseFilter);
    noiseFilter.connect(stepperNoiseGain);
    stepperNoiseGain.connect(audioCtx.destination);

    stepperOsc.connect(filter);
    filter.connect(stepperGain);
    stepperGain.connect(audioCtx.destination);

    whiteNoise.start();
    stepperOsc.start();
  } catch (e) {
    console.warn('[Audio] Stepper synth init error:', e);
  }
}

function startStepperSound() {
  if (isMuted) return;
  const ctx = getAudioCtx();
  if (!stepperGain || !stepperNoiseGain) return;
  const now = ctx.currentTime;
  const vol = (CONFIG.audio_volume || 0.6) * 0.22;
  stepperGain.gain.cancelScheduledValues(now);
  stepperNoiseGain.gain.cancelScheduledValues(now);
  stepperGain.gain.linearRampToValueAtTime(vol, now + 0.05);
  stepperNoiseGain.gain.linearRampToValueAtTime(vol * 0.35, now + 0.05);

  if (stepperOsc) {
    stepperOsc.frequency.cancelScheduledValues(now);
    stepperOsc.frequency.setValueAtTime(180 + Math.random() * 40, now);
  }
}

function stopStepperSound() {
  if (!stepperGain || !stepperNoiseGain || !audioCtx) return;
  const now = audioCtx.currentTime;
  stepperGain.gain.cancelScheduledValues(now);
  stepperNoiseGain.gain.cancelScheduledValues(now);
  stepperGain.gain.linearRampToValueAtTime(0.0001, now + 0.1);
  stepperNoiseGain.gain.linearRampToValueAtTime(0.0001, now + 0.1);
}

function playStampThud() {
  if (isMuted) return;
  const ctx = getAudioCtx();
  const now = ctx.currentTime;
  const vol = (CONFIG.audio_volume || 0.6) * 0.7;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(130, now);
  osc.frequency.exponentialRampToValueAtTime(35, now + 0.16);

  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.22);

  const snap = ctx.createOscillator();
  const snapGain = ctx.createGain();
  snap.type = 'square';
  snap.frequency.setValueAtTime(450, now);
  snap.frequency.exponentialRampToValueAtTime(80, now + 0.08);
  snapGain.gain.setValueAtTime(vol * 0.4, now);
  snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

  snap.connect(snapGain);
  snapGain.connect(ctx.destination);
  snap.start(now);
  snap.stop(now + 0.1);
}

function playFanfare() {
  if (isMuted) return;
  const ctx = getAudioCtx();
  const vol = (CONFIG.audio_volume || 0.6) * 0.35;
  const notes = [440, 554.37, 659.25, 880, 740, 880, 1108.73];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const t = ctx.currentTime + i * 0.11;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);

    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;

    osc.connect(f);
    f.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}

function playChime() {
  if (isMuted) return;
  const ctx = getAudioCtx();
  const vol = (CONFIG.audio_volume || 0.6) * 0.3;
  const notes = [523.25, 659.25, 783.99, 1046.50];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = ctx.currentTime + i * 0.09;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.65);
  });
}

const muteBtn = document.getElementById('mute-btn');
muteBtn.addEventListener('click', toggleMute);

function toggleMute() {
  isMuted = !isMuted;
  muteBtn.textContent = isMuted ? '🔇' : '🔊';
  if (isMuted) stopStepperSound();
}

// ============================================================
// 4. THREE.JS 3D SCENE SETUP
// ============================================================
let scene3D, camera, renderer;
let woodMesh, paperMesh, paperCanvas, paperCtx, paperTexture;
let railLeft, railRight, gantryBar, printHeadMesh;

// 3D Dimensional Constants
const TABLE_W = 34;
const TABLE_D = 46;
const PAPER_W = 16.5;
const PAPER_FLAT_LEN = 24.5;
const PAPER_CURVE_LEN = 5.0;
const PAPER_TOTAL_LEN = PAPER_FLAT_LEN + PAPER_CURVE_LEN;

// Rail & Gantry bounds in 3D (X and Z)
const RAIL_X_LEFT  = -PAPER_W * 0.5 - 1.4;
const RAIL_X_RIGHT =  PAPER_W * 0.5 + 1.4;
const RAIL_Z_MIN   = -13.0; // Top of printable area
const RAIL_Z_MAX   =  10.0; // Bottom before curve

// Canvas resolution for paper texture (high definition)
const CANVAS_W = 1200;
const CANVAS_H = 1800;

function init3D() {
  const container = document.getElementById('canvas-container');
  if (!container) {
    console.error("canvas-container not found!");
    return;
  }

  // Scene
  scene3D = new THREE.Scene();
  scene3D.background = new THREE.Color(0x130e0a);

  // Camera: Perspective with steep plunge angle (55-60°) looking down at table
  camera = new THREE.PerspectiveCamera(50, 1080 / 1920, 0.1, 200);
  camera.position.set(0, 36, 25);
  camera.lookAt(0, 0.5, -1.0);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setSize(1080, 1920);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xfff0db, 0.9);
  scene3D.add(ambientLight);

  const warmKeyLight = new THREE.DirectionalLight(0xfff5ea, 1.4);
  warmKeyLight.position.set(-16, 38, 20);
  warmKeyLight.castShadow = true;
  warmKeyLight.shadow.mapSize.width = 2048;
  warmKeyLight.shadow.mapSize.height = 2048;
  warmKeyLight.shadow.camera.near = 10;
  warmKeyLight.shadow.camera.far = 80;
  warmKeyLight.shadow.camera.left = -22;
  warmKeyLight.shadow.camera.right = 22;
  warmKeyLight.shadow.camera.top = 26;
  warmKeyLight.shadow.camera.bottom = -26;
  warmKeyLight.shadow.bias = -0.0006;
  scene3D.add(warmKeyLight);

  const fillLight = new THREE.DirectionalLight(0xffe2c0, 0.5);
  fillLight.position.set(20, 28, -12);
  scene3D.add(fillLight);

  const rimLight = new THREE.PointLight(0xff8833, 0.6, 60);
  rimLight.position.set(0, 10, -20);
  scene3D.add(rimLight);

  // Build Wooden Table
  buildWoodTable();

  // Build Paper Roll Canvas & Mesh
  buildCurvedPaper();

  // Build Plotter Structure (Rails, Gantry, Head)
  buildPlotterStructure();
}

// Procedural Wooden Table Texture
function createProceduralWoodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  // Honey-dark wood gradient base
  const grad = ctx.createLinearGradient(0, 0, 1024, 1024);
  grad.addColorStop(0, '#2d180d');
  grad.addColorStop(0.3, '#3a2012');
  grad.addColorStop(0.7, '#482816');
  grad.addColorStop(1, '#2c170c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1024);

  // Wood plank seams
  const plankWidth = 1024 / 7;
  for (let i = 0; i <= 7; i++) {
    const x = i * plankWidth;
    ctx.strokeStyle = 'rgba(15, 8, 4, 0.65)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 1024);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 200, 140, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 2, 0);
    ctx.lineTo(x + 2, 1024);
    ctx.stroke();
  }

  // Wood grains
  for (let i = 0; i < 420; i++) {
    const y = Math.random() * 1024;
    ctx.strokeStyle = Math.random() > 0.4 ? 'rgba(20, 10, 5, 0.18)' : 'rgba(180, 110, 60, 0.12)';
    ctx.lineWidth = 0.5 + Math.random() * 2.2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(
      340, y + (Math.random() - 0.5) * 45,
      680, y + (Math.random() - 0.5) * 45,
      1024, y
    );
    ctx.stroke();
  }

  // Soft vignette
  const vig = ctx.createRadialGradient(512, 512, 100, 512, 512, 750);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, 1024, 1024);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.5, 1.5);
  return texture;
}

function buildWoodTable() {
  const woodTexture = createProceduralWoodTexture();
  const tableGeo = new THREE.PlaneGeometry(TABLE_W, TABLE_D);
  const tableMat = new THREE.MeshStandardMaterial({
    map: woodTexture,
    roughness: 0.45,
    metalness: 0.05,
  });

  woodMesh = new THREE.Mesh(tableGeo, tableMat);
  woodMesh.rotation.x = -Math.PI / 2;
  woodMesh.position.set(0, 0, 0);
  woodMesh.receiveShadow = true;
  scene3D.add(woodMesh);

  // Table front edge bevel
  const edgeGeo = new THREE.BoxGeometry(TABLE_W, 1.5, 1.0);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x1f1109, roughness: 0.5 });
  const tableEdge = new THREE.Mesh(edgeGeo, edgeMat);
  tableEdge.position.set(0, -0.75, TABLE_D * 0.5 - 4.5);
  scene3D.add(tableEdge);
}

// Build curved paper mesh hanging over table front
function buildCurvedPaper() {
  paperCanvas = document.createElement('canvas');
  paperCanvas.width = CANVAS_W;
  paperCanvas.height = CANVAS_H;
  paperCtx = paperCanvas.getContext('2d');
  clearPaperCanvas();

  paperTexture = new THREE.CanvasTexture(paperCanvas);
  paperTexture.generateMipmaps = true;
  paperTexture.minFilter = THREE.LinearMipmapLinearFilter;
  paperTexture.magFilter = THREE.LinearFilter;
  paperTexture.wrapS = THREE.ClampToEdgeWrapping;
  paperTexture.wrapT = THREE.RepeatWrapping;
  paperTexture.needsUpdate = true;

  const segmentsX = 24;
  const segmentsZ = 64;
  const paperGeo = new THREE.PlaneGeometry(PAPER_W, PAPER_TOTAL_LEN, segmentsX, segmentsZ);
  paperGeo.rotateX(-Math.PI / 2);

  const pos = paperGeo.attributes.position;
  const frontThreshold = 7.5;
  const maxDrop = 3.8;

  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z > frontThreshold) {
      const progress = Math.min(Math.max((z - frontThreshold) / (PAPER_TOTAL_LEN * 0.5 - frontThreshold), 0), 1);
      const angle = progress * (Math.PI / 2.2);
      const dropY = -Math.sin(angle) * maxDrop;
      pos.setY(i, dropY + 0.08);
      pos.setZ(i, frontThreshold + Math.cos(angle) * (z - frontThreshold));
    } else {
      pos.setY(i, 0.08);
    }
  }
  paperGeo.computeVertexNormals();

  const paperMat = new THREE.MeshStandardMaterial({
    map: paperTexture,
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  paperMesh = new THREE.Mesh(paperGeo, paperMat);
  paperMesh.position.set(0, 0, -2.0);
  paperMesh.receiveShadow = true;
  scene3D.add(paperMesh);
}

function clearPaperCanvas() {
  paperCtx.fillStyle = '#f5ebd2';
  paperCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  paperCtx.strokeStyle = 'rgba(195, 175, 140, 0.45)';
  paperCtx.lineWidth = 4;
  paperCtx.strokeRect(30, 30, CANVAS_W - 60, CANVAS_H - 60);

  paperCtx.strokeStyle = 'rgba(215, 195, 160, 0.15)';
  paperCtx.lineWidth = 1.5;
  for (let y = 60; y < CANVAS_H - 60; y += 40) {
    paperCtx.beginPath();
    paperCtx.moveTo(40, y);
    paperCtx.lineTo(CANVAS_W - 40, y);
    paperCtx.stroke();
  }
}

// Build 3D Plotter Mechanical Structure
function buildPlotterStructure() {
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0xd8d8e2,
    metalness: 0.92,
    roughness: 0.18,
  });

  const blackMat = new THREE.MeshStandardMaterial({
    color: 0x18181c,
    metalness: 0.75,
    roughness: 0.4,
  });

  const railLength = 25.5;
  const railRadius = 0.22;
  const railHeight = 1.45;

  // Left & Right Chrome Rails
  const railGeo = new THREE.CylinderGeometry(railRadius, railRadius, railLength, 24);
  railGeo.rotateX(Math.PI / 2);

  railLeft = new THREE.Mesh(railGeo, metalMat);
  railLeft.position.set(RAIL_X_LEFT, railHeight, -1.5);
  railLeft.castShadow = true;
  scene3D.add(railLeft);

  railRight = new THREE.Mesh(railGeo, metalMat);
  railRight.position.set(RAIL_X_RIGHT, railHeight, -1.5);
  railRight.castShadow = true;
  scene3D.add(railRight);

  // 4 Black Corner Support Brackets
  const cornerGeo = new THREE.BoxGeometry(1.6, 2.0, 1.6);
  const zCorners = [-1.5 - railLength * 0.5, -1.5 + railLength * 0.5];

  [RAIL_X_LEFT, RAIL_X_RIGHT].forEach(x => {
    zCorners.forEach(z => {
      const bracket = new THREE.Mesh(cornerGeo, blackMat);
      bracket.position.set(x, 1.0, z);
      bracket.castShadow = true;
      scene3D.add(bracket);
    });
  });

  // Mobile Horizontal Gantry Bar (Y Axis of Plotter)
  const gantryGroup = new THREE.Group();

  const crossbarWidth = RAIL_X_RIGHT - RAIL_X_LEFT;
  const barGeo = new THREE.CylinderGeometry(0.18, 0.18, crossbarWidth + 0.8, 20);
  barGeo.rotateZ(Math.PI / 2);

  const bar1 = new THREE.Mesh(barGeo, metalMat);
  bar1.position.set(0, 0.18, 0.35);
  bar1.castShadow = true;
  gantryGroup.add(bar1);

  const bar2 = new THREE.Mesh(barGeo, metalMat);
  bar2.position.set(0, 0.18, -0.35);
  bar2.castShadow = true;
  gantryGroup.add(bar2);

  const sliderGeo = new THREE.BoxGeometry(1.2, 1.4, 1.8);
  const sliderLeft = new THREE.Mesh(sliderGeo, blackMat);
  sliderLeft.position.set(RAIL_X_LEFT, 0, 0);
  sliderLeft.castShadow = true;
  gantryGroup.add(sliderLeft);

  const sliderRight = new THREE.Mesh(sliderGeo, blackMat);
  sliderRight.position.set(RAIL_X_RIGHT, 0, 0);
  sliderRight.castShadow = true;
  gantryGroup.add(sliderRight);

  gantryBar = gantryGroup;
  gantryBar.position.set(0, railHeight, RAIL_Z_MIN);
  scene3D.add(gantryBar);

  // Mobile Print Head (X Axis of Plotter)
  const headGroup = new THREE.Group();

  const headBodyGeo = new THREE.BoxGeometry(2.1, 1.5, 1.5);
  const headBody = new THREE.Mesh(headBodyGeo, blackMat);
  headBody.castShadow = true;
  headGroup.add(headBody);

  const nozzleGeo = new THREE.CylinderGeometry(0.12, 0.04, 1.2, 16);
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.25 });
  const nozzle = new THREE.Mesh(nozzleGeo, goldMat);
  nozzle.position.set(0, -0.85, 0);
  nozzle.castShadow = true;
  headGroup.add(nozzle);

  const ledGeo = new THREE.SphereGeometry(0.09, 12, 12);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
  const led = new THREE.Mesh(ledGeo, ledMat);
  led.position.set(0, 0.5, 0.76);
  headGroup.add(led);

  printHeadMesh = headGroup;
  printHeadMesh.position.set(0, railHeight, RAIL_Z_MIN);
  scene3D.add(printHeadMesh);
}

// Set Plotter 3D Positions based on normalized canvas coordinates [0..1]
function setPlotterPosition(normX, normY) {
  const marginW = 1.6;
  const xMin = RAIL_X_LEFT + marginW;
  const xMax = RAIL_X_RIGHT - marginW;
  const targetX = xMin + normX * (xMax - xMin);

  const zMin = RAIL_Z_MIN + 0.8;
  const zMax = RAIL_Z_MAX - 1.2;
  const targetZ = zMin + normY * (zMax - zMin);

  if (gantryBar) {
    gantryBar.position.z = targetZ;
  }
  if (printHeadMesh) {
    printHeadMesh.position.z = targetZ;
    printHeadMesh.position.x = targetX;
  }
}

// ============================================================
// 5. PRINT QUEUE & GRID MANAGEMENT (3x3 Slots & Page Scrolling)
// ============================================================
const printQueue = [];
let isPrinting = false;

let pageSlots = new Array(9).fill(null);
let hasDrawingsOnPage = false;

const GRID_MARGIN_X = 90;
const GRID_MARGIN_Y = 120;
const GRID_GAP_X    = 40;
const GRID_GAP_Y    = 50;
const GRID_COLS     = 3;
const GRID_ROWS     = 3;

const SLOT_W = (CANVAS_W - GRID_MARGIN_X * 2 - GRID_GAP_X * (GRID_COLS - 1)) / GRID_COLS;
const SLOT_H = (CANVAS_H - GRID_MARGIN_Y * 2 - GRID_GAP_Y * (GRID_ROWS - 1)) / GRID_ROWS;

function getSlotRect(slotIdx) {
  const col = slotIdx % GRID_COLS;
  const row = Math.floor(slotIdx / GRID_COLS);
  const x = GRID_MARGIN_X + col * (SLOT_W + GRID_GAP_X);
  const y = GRID_MARGIN_Y + row * (SLOT_H + GRID_GAP_Y);
  return { x, y, w: SLOT_W, h: SLOT_H, col, row };
}

function getBigRect(anchorSlot) {
  const rect0 = getSlotRect(anchorSlot);
  const w = SLOT_W * 2 + GRID_GAP_X;
  const h = SLOT_H * 2 + GRID_GAP_Y;
  return { x: rect0.x, y: rect0.y, w, h };
}

function findSlotForPrint() {
  for (let i = 0; i < 9; i++) {
    if (pageSlots[i] === null) return i;
  }
  return -1;
}

function findAnchorForBig() {
  const anchors = [0, 1, 3, 4];
  for (const anchor of anchors) {
    const s0 = anchor;
    const s1 = anchor + 1;
    const s2 = anchor + 3;
    const s3 = anchor + 4;
    if (
      pageSlots[s0] === null &&
      pageSlots[s1] === null &&
      pageSlots[s2] === null &&
      pageSlots[s3] === null
    ) {
      return anchor;
    }
  }
  return -1;
}

function updateHUDStatus() {
  const occupied = pageSlots.filter(s => s !== null).length;
  updateHUD('queue', `Queue: ${printQueue.length}`);
  updateHUD('page', `Slot: ${occupied}/9`);
}

function setStatusPill(text, isGreen = true) {
  const pillText = document.getElementById('status-pill-text');
  const dot = document.querySelector('.status-dot');
  if (pillText) pillText.textContent = text;
  if (dot) {
    dot.style.background = isGreen ? '#10b981' : '#f59e0b';
    dot.style.boxShadow  = isGreen ? '0 0 10px #10b981' : '0 0 10px #f59e0b';
  }
}

function enqueuePrintJob(job) {
  if (job.tier === 'vip') {
    printQueue.unshift(job);
  } else {
    printQueue.push(job);
  }
  setStatusPill(`@${job.user} → added to the draw queue.`);
  updateHUDStatus();
  if (!isPrinting) processNextJob();
}

async function processNextJob() {
  if (printQueue.length === 0) {
    isPrinting = false;
    updateHUDStatus();
    setStatusPill('Ready to print');
    setPlotterPosition(0.5, 0.05);
    return;
  }

  isPrinting = true;
  const job = printQueue.shift();
  updateHUDStatus();

  try {
    await executeJob(job);
  } catch (err) {
    console.error('[Plotter] Print execution error:', err);
  }

  await sleep(250);
  processNextJob();
}

// ============================================================
// 6. DRAWING & PLOTTER SWEEP ANIMATION
// ============================================================
async function executeJob(job) {
  const { tier, user, avatar } = job;
  setStatusPill(`Drawing @${user} - Queue: ${printQueue.length}`, false);

  const avatarImg = await loadAvatarImage(user, avatar);

  if (tier === 'vip') {
    if (hasDrawingsOnPage) {
      await advancePaperPage();
    }
    await drawVipPage(job, avatarImg);
    await sleep(2500);
    await advancePaperPage();
  } else if (tier === 'big') {
    let anchor = findAnchorForBig();
    if (anchor === -1) {
      await advancePaperPage();
      anchor = 0;
    }
    pageSlots[anchor] = job;
    pageSlots[anchor + 1] = job;
    pageSlots[anchor + 3] = job;
    pageSlots[anchor + 4] = job;
    hasDrawingsOnPage = true;

    playChime();
    const rect = getBigRect(anchor);
    await drawCardSweep(rect, job, avatarImg, 'big');
  } else {
    let slot = findSlotForPrint();
    if (slot === -1) {
      await advancePaperPage();
      slot = 0;
    }
    pageSlots[slot] = job;
    hasDrawingsOnPage = true;

    const rect = getSlotRect(slot);
    await drawCardSweep(rect, job, avatarImg, 'print');
  }

  updateHUDStatus();
}

async function advancePaperPage() {
  const duration = CONFIG.paper_scroll_speed_ms || 900;
  const startTime = performance.now();

  startStepperSound();
  await new Promise(resolve => {
    function animateScroll(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      paperTexture.offset.y = -ease;

      if (progress < 1) {
        requestAnimationFrame(animateScroll);
      } else {
        paperTexture.offset.y = 0;
        clearPaperCanvas();
        paperTexture.needsUpdate = true;
        pageSlots.fill(null);
        hasDrawingsOnPage = false;
        resolve();
      }
    }
    requestAnimationFrame(animateScroll);
  });
  stopStepperSound();
}

async function drawCardSweep(rect, job, avatarImg, tier) {
  const cardCanvas = document.createElement('canvas');
  cardCanvas.width = rect.w;
  cardCanvas.height = rect.h;
  const cctx = cardCanvas.getContext('2d');
  renderCardOnContext(cctx, rect.w, rect.h, job, avatarImg, tier);

  const duration = tier === 'big' ? CONFIG.print_speed_ms * 1.3 : CONFIG.print_speed_ms;
  const startTime = performance.now();

  startStepperSound();

  await new Promise(resolve => {
    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const currentH = Math.max(1, Math.floor(progress * rect.h));

      paperCtx.drawImage(
        cardCanvas,
        0, 0, rect.w, currentH,
        rect.x, rect.y, rect.w, currentH
      );
      paperTexture.needsUpdate = true;

      const scanPasses = tier === 'big' ? 18 : 12;
      const headOsc = 0.5 + 0.5 * Math.sin(progress * Math.PI * scanPasses);
      const currPixelX = rect.x + headOsc * rect.w;
      const currPixelY = rect.y + currentH;

      setPlotterPosition(currPixelX / CANVAS_W, currPixelY / CANVAS_H);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        paperCtx.drawImage(cardCanvas, rect.x, rect.y);
        paperTexture.needsUpdate = true;
        resolve();
      }
    }
    requestAnimationFrame(step);
  });

  stopStepperSound();
}

function renderCardOnContext(ctx, w, h, job, avatarImg, tier) {
  const isBig = tier === 'big';

  ctx.fillStyle = '#ffffff';
  const radius = isBig ? 14 : 10;
  roundRect(ctx, 4, 4, w - 8, h - 8, radius);
  ctx.fill();

  ctx.lineWidth = isBig ? 6 : 3;
  ctx.strokeStyle = isBig ? '#ff8c00' : '#222222';
  roundRect(ctx, 4, 4, w - 8, h - 8, radius);
  ctx.stroke();

  const avatarSize = isBig ? Math.min(w * 0.58, h * 0.46) : Math.min(w * 0.65, h * 0.45);
  const avatarX = w * 0.5;
  const avatarY = isBig ? h * 0.38 : h * 0.38;

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarSize * 0.5, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) {
    ctx.drawImage(
      avatarImg,
      avatarX - avatarSize * 0.5,
      avatarY - avatarSize * 0.5,
      avatarSize,
      avatarSize
    );
  } else {
    ctx.fillStyle = '#4f46e5';
    ctx.fillRect(avatarX - avatarSize * 0.5, avatarY - avatarSize * 0.5, avatarSize, avatarSize);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${avatarSize * 0.45}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((job.user || 'U').charAt(0).toUpperCase(), avatarX, avatarY);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarSize * 0.5, 0, Math.PI * 2);
  ctx.lineWidth = isBig ? 4 : 2.5;
  ctx.strokeStyle = isBig ? '#ffa726' : '#333333';
  ctx.stroke();

  ctx.fillStyle = '#18181b';
  ctx.font = isBig ? 'bold 26px sans-serif' : 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const nameY = avatarY + avatarSize * 0.5 + (isBig ? 34 : 26);
  ctx.fillText(`@${job.user}`, avatarX, nameY, w - 24);

  const giftY = nameY + (isBig ? 38 : 28);
  const giftText = `${job.gift || 'Gift'} ${job.count > 1 ? `x${job.count}` : ''}`;
  ctx.font = isBig ? '600 20px sans-serif' : '600 14px sans-serif';
  const textMetrics = ctx.measureText(giftText);
  const pillW = textMetrics.width + (isBig ? 36 : 24);
  const pillH = isBig ? 34 : 26;

  ctx.fillStyle = isBig ? '#fff3e0' : '#f4f4f5';
  roundRect(ctx, avatarX - pillW * 0.5, giftY - pillH * 0.5, pillW, pillH, pillH * 0.5);
  ctx.fill();
  ctx.strokeStyle = isBig ? '#ffb74d' : '#e4e4e7';
  ctx.lineWidth = 1.5;
  roundRect(ctx, avatarX - pillW * 0.5, giftY - pillH * 0.5, pillW, pillH, pillH * 0.5);
  ctx.stroke();

  ctx.fillStyle = isBig ? '#e65100' : '#52525b';
  ctx.fillText(giftText, avatarX, giftY);
}

// ============================================================
// 7. SUPER VIP DRAWING & TWO DRY STAMPS
// ============================================================
async function drawVipPage(job, avatarImg) {
  playFanfare();

  const vipCanvas = document.createElement('canvas');
  vipCanvas.width = CANVAS_W;
  vipCanvas.height = CANVAS_H;
  const vctx = vipCanvas.getContext('2d');

  renderVipBaseTemplate(vctx, job, avatarImg);

  const duration = CONFIG.print_speed_ms * 1.8;
  const startTime = performance.now();
  startStepperSound();

  await new Promise(resolve => {
    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const currentH = Math.max(1, Math.floor(progress * (CANVAS_H - 120)));

      paperCtx.drawImage(
        vipCanvas,
        0, 0, CANVAS_W, currentH + 60,
        0, 0, CANVAS_W, currentH + 60
      );
      paperTexture.needsUpdate = true;

      const headOsc = 0.5 + 0.45 * Math.sin(progress * Math.PI * 24);
      setPlotterPosition(headOsc, (currentH + 60) / CANVAS_H);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        paperCtx.drawImage(vipCanvas, 0, 0);
        paperTexture.needsUpdate = true;
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
  stopStepperSound();

  await sleep(200);
  playStampThud();
  stampSuperVipBadge(paperCtx);
  paperTexture.needsUpdate = true;

  await sleep(300);
  playStampThud();
  stampThankYouBadge(paperCtx);
  paperTexture.needsUpdate = true;
}

function renderVipBaseTemplate(ctx, job, avatarImg) {
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 14;
  roundRect(ctx, 50, 50, CANVAS_W - 100, CANVAS_H - 100, 24);
  ctx.stroke();

  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 4;
  roundRect(ctx, 70, 70, CANVAS_W - 140, CANVAS_H - 140, 16);
  ctx.stroke();

  ctx.fillStyle = '#b91c1c';
  ctx.font = '900 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('★ LEGENDARY VIP ★', CANVAS_W * 0.5, 160);

  const avatarSize = 460;
  const avatarX = CANVAS_W * 0.5;
  const avatarY = CANVAS_H * 0.44;

  ctx.save();
  ctx.translate(avatarX, avatarY);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 4;
  for (let i = 0; i < 36; i++) {
    ctx.rotate((Math.PI * 2) / 36);
    ctx.beginPath();
    ctx.moveTo(avatarSize * 0.52, 0);
    ctx.lineTo(avatarSize * 0.58 + (i % 2 === 0 ? 18 : 6), 0);
    ctx.stroke();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarSize * 0.54, 0, Math.PI * 2);
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#eab308';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarSize * 0.51, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#dc2626';
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarSize * 0.49, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) {
    ctx.drawImage(
      avatarImg,
      avatarX - avatarSize * 0.5,
      avatarY - avatarSize * 0.5,
      avatarSize,
      avatarSize
    );
  } else {
    ctx.fillStyle = '#b91c1c';
    ctx.fillRect(avatarX - avatarSize * 0.5, avatarY - avatarSize * 0.5, avatarSize, avatarSize);
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 160px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((job.user || 'V').charAt(0).toUpperCase(), avatarX, avatarY);
  }
  ctx.restore();

  const badgeY = avatarY - avatarSize * 0.5 - 32;
  ctx.fillStyle = '#dc2626';
  roundRect(ctx, avatarX - 110, badgeY - 30, 220, 60, 30);
  ctx.fill();
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 4;
  roundRect(ctx, avatarX - 110, badgeY - 30, 220, 60, 30);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('👑 TOP 1', avatarX, badgeY);

  ctx.fillStyle = '#0f172a';
  ctx.font = '900 62px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`@${job.user}`, avatarX, avatarY + avatarSize * 0.5 + 75, CANVAS_W - 160);

  ctx.fillStyle = '#b45309';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(`Sent: ${job.gift || 'Legendary Gift'} (${job.diamonds || 100}+ Coins)`, avatarX, avatarY + avatarSize * 0.5 + 145);
}

function stampSuperVipBadge(ctx) {
  ctx.save();
  const stampX = CANVAS_W - 270;
  const stampY = CANVAS_H - 260;
  ctx.translate(stampX, stampY);
  ctx.rotate((-12 * Math.PI) / 180);

  ctx.strokeStyle = 'rgba(220, 38, 38, 0.92)';
  ctx.lineWidth = 7;
  roundRect(ctx, -140, -45, 280, 90, 10);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(220, 38, 38, 0.45)';
  ctx.lineWidth = 2.5;
  roundRect(ctx, -132, -37, 264, 74, 6);
  ctx.stroke();

  ctx.fillStyle = 'rgba(220, 38, 38, 0.94)';
  ctx.font = '900 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SUPER VIP', 0, 0);

  ctx.restore();
}

function stampThankYouBadge(ctx) {
  ctx.save();
  const stampX = 270;
  const stampY = CANVAS_H - 260;
  ctx.translate(stampX, stampY);
  ctx.rotate((15 * Math.PI) / 180);

  ctx.strokeStyle = 'rgba(180, 130, 20, 0.88)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(0, 0, 130, 52, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(217, 119, 6, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 122, 44, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(180, 120, 20, 0.95)';
  ctx.font = 'italic 700 36px "Brush Script MT", "Caveat", "Segoe Script", cursive, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Thank You!', 0, 0);

  ctx.restore();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function loadAvatarImage(user, avatarUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const finalUrl = avatarUrl
      ? `/api/avatar?url=${encodeURIComponent(avatarUrl)}`
      : `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(user)}&backgroundColor=b6e3f4,c0aede,ffd5dc`;

    img.onload = () => resolve(img);
    img.onerror = () => {
      const fallback = new Image();
      fallback.crossOrigin = 'anonymous';
      fallback.onload = () => resolve(fallback);
      fallback.onerror = () => resolve(null);
      fallback.src = `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(user)}`;
    };
    img.src = finalUrl;
  });
}

// ============================================================
// 8. WEBSOCKET CLIENT (Auto-reconnect)
// ============================================================
let ws = null;
const WS_URL = 'ws://localhost:8765';
let reconnectTimer = null;

function connectWS() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  updateHUD('ws', 'Connecting…');
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    updateHUD('ws', '🟢 Connected');
    console.log('[WS] Connected to', WS_URL);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = event => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (e) {
      console.warn('[WS] Parse error:', e);
    }
  };

  ws.onerror = () => {
    updateHUD('ws', '🔴 Error');
  };

  ws.onclose = () => {
    updateHUD('ws', '🟡 Reconnecting…');
    reconnectTimer = setTimeout(connectWS, 3000);
  };
}

function handleServerMessage(data) {
  if (data.type === 'print_job') {
    enqueuePrintJob(data);
  } else if (data.type === 'config') {
    CONFIG = { ...CONFIG, ...(data.data || {}) };
    updateLegend();
  } else if (data.type === 'status') {
    updateHUD('ws', data.connected ? '🟢 Live' : '🟡 Disconnected');
  }
}

// ============================================================
// 9. DEBUG HUD & KEYBOARD SHORTCUTS
// ============================================================
let hudVisible = false;
const hud = document.getElementById('debug-hud');

function updateHUD(key, value) {
  const el = document.getElementById(`hud-${key}`);
  if (el) el.textContent = `${key.toUpperCase()}: ${value}`;
}

function toggleHUD() {
  hudVisible = !hudVisible;
  hud.classList.toggle('hidden', !hudVisible);
}

const MOCK_NAMES = ['Alex', 'Bella', 'Carlos', 'Dani', 'Elena', 'Franco', 'Gina', 'Hector', 'Ivy', 'Leo'];
const MOCK_SEEDS = ['Nova', 'Pixel', 'Sonic', 'Luna', 'Atlas', 'Zephyr', 'Orion', 'Echo'];
const MOCK_GIFTS = { print: 'Rose', big: 'Doughnut', vip: 'Legendary VIP' };
const MOCK_DIAMONDS = { print: 1, big: 30, vip: 500 };

function createMockJob(tier) {
  const name = MOCK_NAMES[Math.floor(Math.random() * MOCK_NAMES.length)];
  const seed = MOCK_SEEDS[Math.floor(Math.random() * MOCK_SEEDS.length)];
  return {
    type: 'print_job',
    user: name,
    avatar: `https://api.dicebear.com/9.x/avataaars/svg?seed=${seed}&backgroundColor=b6e3f4,c0aede,ffd5dc`,
    tier,
    gift: MOCK_GIFTS[tier],
    gift_id: 0,
    count: 1,
    diamonds: MOCK_DIAMONDS[tier],
  };
}

document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  switch (e.key) {
    case '1':
      enqueuePrintJob(createMockJob('print'));
      break;
    case '2':
      enqueuePrintJob(createMockJob('big'));
      break;
    case '3':
      enqueuePrintJob(createMockJob('vip'));
      break;
    case '4':
      for (let i = 0; i < 5; i++) {
        const tiers = ['print', 'print', 'big', 'print', 'vip'];
        const tier = tiers[i % tiers.length];
        setTimeout(() => enqueuePrintJob(createMockJob(tier)), i * 140);
      }
      break;
    case 'h':
    case 'H':
      toggleHUD();
      break;
    case 'm':
    case 'M':
      toggleMute();
      break;
  }
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 10. MAIN RENDER LOOP & INITIALIZATION
// ============================================================
let lastFpsTime = performance.now();
let frames = 0;

function animate(now) {
  requestAnimationFrame(animate);

  if (renderer && scene3D && camera) {
    renderer.render(scene3D, camera);
  }

  frames++;
  if (now - lastFpsTime >= 1000) {
    updateHUD('fps', `FPS: ${frames}`);
    frames = 0;
    lastFpsTime = now;
  }
}

(async function boot() {
  try {
    scaleScene();
    window.addEventListener('resize', scaleScene);
    await fetchConfig();
    init3D();
    connectWS();
    updateHUDStatus();

    setPlotterPosition(0.5, 0.05);

    requestAnimationFrame(animate);

    console.log('%c🖨️ TikTok Plotter 3D Live Ready', 'font-size:22px;color:#d4af37;font-weight:bold');
  } catch (err) {
    console.error('Fatal initialization error:', err);
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'position:fixed;top:20px;left:20px;background:rgba(220,38,38,0.92);color:white;padding:20px;border-radius:12px;font-family:sans-serif;font-size:16px;z-index:999999;box-shadow:0 10px 30px rgba(0,0,0,0.5);';
    errDiv.innerHTML = `<b>Error al iniciar escena 3D:</b><br>${err.message}`;
    document.body.appendChild(errDiv);
  }
})();
