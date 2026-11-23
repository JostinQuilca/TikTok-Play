/**
 * TikTok Printer Live — app.js
 * Main application logic: WebSocket, PrintQueue, Animations, Audio, Fire, Keys
 */

'use strict';

// ============================================================
// 1. SCENE SCALING (auto-fit 1080x1920 to any viewport)
// ============================================================
function scaleScene() {
  const scene  = document.getElementById('scene');
  const scaleX = window.innerWidth  / 1080;
  const scaleY = window.innerHeight / 1920;
  const scale  = Math.min(scaleX, scaleY);
  scene.style.transform       = `scale(${scale})`;
  scene.style.marginLeft      = `${(window.innerWidth  - 1080 * scale) / 2}px`;
  scene.style.marginTop       = `${(window.innerHeight - 1920 * scale) / 2}px`;
  scene.style.transformOrigin = 'top left';
}
scaleScene();
window.addEventListener('resize', scaleScene);

// ============================================================
// 2. CONFIGURATION (fetched from /api/config)
// ============================================================
let CONFIG = {
  print_speed_ms:      2500,
  paper_scroll_speed_ms: 800,
  audio_volume:        0.6,
  gift_tiers: {
    print: { label: 'Rose → Print',        emoji: '🌹', frame_color: '#c4a882' },
    big:   { label: 'Donut → Big Print',   emoji: '🍩', frame_color: '#ff8c00' },
    vip:   { label: '100+ → Legendary VIP',emoji: '👑', frame_color: '#ffd700' },
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
// 3. WEBSOCKET CONNECTION (auto-reconnect)
// ============================================================
let ws         = null;
let wsConnected = false;
const WS_URL   = 'ws://localhost:8765';
let reconnectTimer = null;

function connectWS() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  updateHUD('ws', 'Connecting…');
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    wsConnected = true;
    updateHUD('ws', '🟢 Connected');
    console.log('[WS] Connected to', WS_URL);
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (e) {
      console.warn('[WS] Bad JSON:', e);
    }
  };

  ws.onerror = () => {
    wsConnected = false;
    updateHUD('ws', '🔴 Error');
  };

  ws.onclose = () => {
    wsConnected = false;
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
// 4. PRINT QUEUE
// ============================================================
const printQueue  = [];
let   isPrinting  = false;

function enqueuePrintJob(job) {
  if (job.tier === 'vip') {
    // VIP goes to front
    printQueue.unshift(job);
  } else {
    printQueue.push(job);
  }
  updateHUD('queue', `Queue: ${printQueue.length}`);
  if (!isPrinting) processNextJob();
}

async function processNextJob() {
  if (printQueue.length === 0) {
    isPrinting = false;
    updateHUD('queue', 'Queue: 0');
    stopCarriage();
    return;
  }
  isPrinting = true;
  const job  = printQueue.shift();
  updateHUD('queue', `Queue: ${printQueue.length}`);

  try {
    await printJob(job);
  } catch (e) {
    console.error('[Print] Error:', e);
  }

  // Small gap between prints
  await sleep(300);
  processNextJob();
}

// ============================================================
// 5. PRINT JOB — Animation
// ============================================================
const paperContent = document.getElementById('paper-content');
const paperRoll    = document.getElementById('paper-roll');
const paperContainer = document.getElementById('paper-container');

// Track pending small-tier cards (2 per row)
let pendingSmallRow = null; // { el, count }

async function printJob(job) {
  const { tier, user, avatar, gift, count, diamonds } = job;

  // VIP flash overlay
  if (tier === 'vip') {
    showVipOverlay(user);
    spawnVipParticles();
    playSound('vip');
  } else if (tier === 'big') {
    playSound('big');
  } else {
    playSound('print');
  }

  // Start carriage animation
  startCarriage();

  // Create card DOM element
  const card = createCardElement(job);

  // Decide row placement
  let row;
  if (tier === 'print') {
    // Try to place 2 small cards per row
    if (pendingSmallRow && pendingSmallRow.count === 1) {
      // Second card: just append to existing top row — no slide needed
      row = pendingSmallRow.el;
      row.appendChild(card);
      pendingSmallRow = null;
    } else {
      // First small card: prepend a new row at the top and slide down
      row = document.createElement('div');
      row.className = 'print-row';
      paperContent.prepend(row);
      row.appendChild(card);
      pendingSmallRow = { el: row, count: 1 };
      await slideRollDown(row);
    }
  } else {
    // big/vip: own full row, flush pending small row
    pendingSmallRow = null;
    row = document.createElement('div');
    row.className = 'print-row';
    paperContent.prepend(row);
    row.appendChild(card);
    await slideRollDown(row);
  }

  // Wait a moment, then reveal the card top-to-bottom
  await sleep(200);
  card.classList.add('revealed');

  // Wait for print animation (tied to tier)
  const printDuration = tier === 'vip' ? CONFIG.print_speed_ms * 1.6
                      : tier === 'big' ? CONFIG.print_speed_ms * 1.2
                      : CONFIG.print_speed_ms;
  await sleep(printDuration);

  stopCarriage();

  // After a delay, scroll down to simulate paper advancing
  await sleep(500);

  // Check if older items are below fire zone — burn them
  burnOldCards();
}

function createCardElement(job) {
  const { tier, user, avatar, gift, count } = job;

  const card = document.createElement('div');
  card.className = `print-card tier-${tier}`;

  const frame = document.createElement('div');
  frame.className = 'card-frame';

  // Avatar
  const img = document.createElement('img');
  img.className = 'card-avatar';
  img.alt = user;

  // Use proxy to avoid CORS
  const proxyUrl = avatar
    ? `/api/avatar?url=${encodeURIComponent(avatar)}`
    : `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(user)}`;
  img.src = proxyUrl;
  img.onerror = () => {
    // Fallback to emoji
    frame.removeChild(img);
    const fb = document.createElement('div');
    fb.className = 'card-avatar-fallback';
    fb.textContent = user.charAt(0).toUpperCase() || '👤';
    frame.appendChild(fb);
  };

  frame.appendChild(img);
  card.appendChild(frame);

  // VIP badge
  if (tier === 'vip') {
    const badge = document.createElement('div');
    badge.className = 'vip-badge';
    badge.textContent = '👑 VIP';
    card.appendChild(badge);
  }

  // Username
  const nameEl = document.createElement('div');
  nameEl.className = 'card-username';
  nameEl.textContent = `@${user}`;
  card.appendChild(nameEl);

  // Gift label
  const giftEl = document.createElement('div');
  giftEl.className = 'card-gift';
  const tiers = CONFIG.gift_tiers || {};
  const emoji = (tiers[tier] || {}).emoji || '🎁';
  giftEl.textContent = `${emoji} ${gift}${count > 1 ? ` x${count}` : ''}`;
  card.appendChild(giftEl);

  return card;
}

// ============================================================
// 6. PAPER SLIDING (new rows enter from top, push old ones down)
// ============================================================
function slideRollDown(newRow) {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      // Measure the height of the newly prepended row
      const rowHeight = newRow.offsetHeight;

      // Jump up by rowHeight (no animation) so the content looks unchanged
      paperRoll.style.transition = 'none';
      paperRoll.style.transform  = `translateY(-${rowHeight}px)`;

      // Force reflow so the browser commits the instant jump
      void paperRoll.offsetHeight;

      // Animate back to 0 — this is the smooth downward slide
      paperRoll.style.transition = `transform ${CONFIG.paper_scroll_speed_ms}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
      paperRoll.style.transform  = 'translateY(0)';

      setTimeout(resolve, CONFIG.paper_scroll_speed_ms + 50);
    });
  });
}

// ============================================================
// 7. BURN OLD CARDS
// ============================================================
function burnOldCards() {
  // Use real position of the fire zone element, not a viewport percentage
  const fireTop = document.getElementById('fire-zone').getBoundingClientRect().top;

  const cards = paperContent.querySelectorAll('.print-card:not(.burning):not(.burned)');
  cards.forEach(card => {
    const rect = card.getBoundingClientRect();
    // Burn only cards whose bottom enters the fire zone (with 20px buffer)
    if (rect.bottom >= fireTop + 20) {
      burnCard(card);
    }
  });

  // Aggressive cleanup: remove oldest rows (at the END of the container, since
  // new rows are prepended so oldest ones sink to the bottom)
  const rows = paperContent.querySelectorAll('.print-row');
  if (rows.length > 15) {
    for (let i = rows.length - 1; i >= 15; i--) {
      rows[i].remove();
    }
  }
}

function burnCard(card) {
  if (card.classList.contains('burning') || card.classList.contains('burned')) return;
  card.classList.add('burning');
  spawnBurnSparks(card);
  setTimeout(() => {
    card.classList.add('burned');
    const row = card.closest('.print-row');
    if (row && row.querySelectorAll('.print-card:not(.burned)').length === 0) {
      setTimeout(() => row.remove(), 100);
    }
  }, 1600);
}

function spawnBurnSparks(card) {
  const rect    = card.getBoundingClientRect();
  const scene   = document.getElementById('scene');
  const sceneR  = scene.getBoundingClientRect();
  const scale   = sceneR.width / 1080;

  for (let i = 0; i < 8; i++) {
    const spark = document.createElement('div');
    spark.style.cssText = `
      position:fixed;
      left:${rect.left + rect.width * Math.random()}px;
      top:${rect.bottom}px;
      width:${4 + Math.random() * 6}px;
      height:${4 + Math.random() * 6}px;
      border-radius:50%;
      background:${Math.random() > 0.5 ? '#ff6b1a' : '#ffd700'};
      pointer-events:none;
      z-index:1000;
      animation:sparkFly 1s ease-out forwards;
      --tx:${(Math.random() - 0.5) * 60}px;
      --ty:${-50 - Math.random() * 80}px;
    `;
    document.body.appendChild(spark);
    setTimeout(() => spark.remove(), 1100);
  }
}

// Add spark keyframe to document
const sparkStyle = document.createElement('style');
sparkStyle.textContent = `
  @keyframes sparkFly {
    0%   { opacity:1; transform:translate(0,0) scale(1); }
    100% { opacity:0; transform:translate(var(--tx), var(--ty)) scale(0.2); }
  }
`;
document.head.appendChild(sparkStyle);

// ============================================================
// 8. CARRIAGE ANIMATION
// ============================================================
const carriage = document.getElementById('carriage');

function startCarriage() {
  carriage.classList.add('printing');
}

function stopCarriage() {
  carriage.classList.remove('printing');
}

// ============================================================
// 9. FIRE CANVAS (Particle System)
// ============================================================
const fireCanvas  = document.getElementById('fire-canvas');
const fireCtx     = fireCanvas.getContext('2d');
const FIRE_W      = 600;
const FIRE_H      = 300;
fireCanvas.width  = FIRE_W;
fireCanvas.height = FIRE_H;

const fireParticles = [];

function spawnFireParticle() {
  const x = FIRE_W * 0.5 + (Math.random() - 0.5) * FIRE_W * 0.6;
  fireParticles.push({
    x,
    y:    FIRE_H,
    vx:   (Math.random() - 0.5) * 1.5,
    vy:   -(2 + Math.random() * 4),
    life: 1,
    decay: 0.012 + Math.random() * 0.015,
    size: 6 + Math.random() * 18,
    hue:  Math.random() > 0.6 ? 50 : (Math.random() > 0.5 ? 20 : 5),
  });
}

function updateFire() {
  fireCtx.clearRect(0, 0, FIRE_W, FIRE_H);

  // Spawn new particles
  for (let i = 0; i < 6; i++) spawnFireParticle();

  // Update & draw
  for (let i = fireParticles.length - 1; i >= 0; i--) {
    const p = fireParticles[i];
    p.x    += p.vx + Math.sin(p.life * 10) * 0.4;
    p.y    += p.vy;
    p.life -= p.decay;
    p.size *= 0.985;

    if (p.life <= 0 || p.size < 1) {
      fireParticles.splice(i, 1);
      continue;
    }

    const alpha     = p.life;
    const gradient  = fireCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);

    if (p.hue === 50) {
      gradient.addColorStop(0, `rgba(255,255,180,${alpha})`);
      gradient.addColorStop(0.4, `rgba(255,220,50,${alpha * 0.8})`);
      gradient.addColorStop(1,   `rgba(255,120,0,0)`);
    } else if (p.hue === 20) {
      gradient.addColorStop(0, `rgba(255,180,30,${alpha})`);
      gradient.addColorStop(0.4, `rgba(255,80,0,${alpha * 0.7})`);
      gradient.addColorStop(1,   `rgba(200,30,0,0)`);
    } else {
      gradient.addColorStop(0, `rgba(255,80,0,${alpha * 0.8})`);
      gradient.addColorStop(0.5, `rgba(180,20,0,${alpha * 0.5})`);
      gradient.addColorStop(1,   `rgba(80,0,0,0)`);
    }

    fireCtx.beginPath();
    fireCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    fireCtx.fillStyle = gradient;
    fireCtx.fill();
  }

  // Ember sparks (random)
  if (Math.random() < 0.08) {
    const ex = FIRE_W * 0.5 + (Math.random() - 0.5) * 200;
    const ey = FIRE_H * 0.4 + Math.random() * FIRE_H * 0.4;
    fireCtx.beginPath();
    fireCtx.arc(ex, ey, 1 + Math.random() * 2, 0, Math.PI * 2);
    fireCtx.fillStyle = `rgba(255,${150 + Math.random() * 100},0,${0.5 + Math.random() * 0.5})`;
    fireCtx.fill();
  }
}

// FPS tracking
let lastFpsTime  = performance.now();
let frameCount   = 0;

function animLoop(ts) {
  updateFire();

  // FPS calc
  frameCount++;
  if (ts - lastFpsTime > 1000) {
    updateHUD('fps', `FPS: ${frameCount}`);
    frameCount  = 0;
    lastFpsTime = ts;
  }

  requestAnimationFrame(animLoop);
}
requestAnimationFrame(animLoop);

// ============================================================
// 10. VIP OVERLAY
// ============================================================
const vipOverlay   = document.getElementById('vip-overlay');
const vipParticles = document.getElementById('vip-particles');
let   vipTimer     = null;

function showVipOverlay(user) {
  const title = document.getElementById('vip-title');
  title.textContent = `👑 ${user} 👑`;
  vipOverlay.classList.remove('hidden');
  if (vipTimer) clearTimeout(vipTimer);
  vipTimer = setTimeout(() => vipOverlay.classList.add('hidden'), 3200);
}

function spawnVipParticles() {
  vipParticles.innerHTML = '';
  const colors = ['#ffd700','#ff00ff','#00ffff','#ff6b1a','#ffffff'];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('div');
    p.className = 'vip-particle';
    const color = colors[Math.floor(Math.random() * colors.length)];
    const dur   = 1.5 + Math.random() * 2;
    const tx    = (Math.random() - 0.5) * 800;
    const ty    = -200 - Math.random() * 600;
    const left  = 20 + Math.random() * 60;
    const top   = 30 + Math.random() * 40;
    p.style.cssText = `
      left:${left}%;top:${top}%;
      background:${color};
      --dur:${dur}s;
      --tx:${tx}px;
      --ty:${ty}px;
      box-shadow:0 0 6px ${color};
    `;
    vipParticles.appendChild(p);
  }
}

// ============================================================
// 11. WEB AUDIO — Procedural Sounds
// ============================================================
let audioCtx  = null;
let muted     = false;
const muteBtn = document.getElementById('mute-btn');

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playSound(type) {
  if (muted) return;
  const ctx = getAudioCtx();
  const vol = CONFIG.audio_volume ?? 0.6;

  if (type === 'print') {
    playPrinterSound(ctx, vol);
  } else if (type === 'big') {
    playPrinterSound(ctx, vol);
    setTimeout(() => playChime(ctx, vol, [523, 659, 784]), 200);
  } else if (type === 'vip') {
    playPrinterSound(ctx, vol);
    setTimeout(() => playFanfare(ctx, vol), 100);
  }
}

function playPrinterSound(ctx, vol) {
  // Mechanical buzzing / dot-matrix sound
  const bufferSize = ctx.sampleRate * 0.4;
  const buffer     = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data       = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    // Modulated noise
    const env = Math.sin((i / bufferSize) * Math.PI);
    data[i] = (Math.random() * 2 - 1) * env * 0.4
            + Math.sin(i * 0.15) * env * 0.2
            + Math.sin(i * 0.42) * env * 0.1;
  }
  const src    = ctx.createBufferSource();
  src.buffer   = buffer;
  const gain   = ctx.createGain();
  gain.gain.setValueAtTime(vol * 0.5, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

  const filter = ctx.createBiquadFilter();
  filter.type  = 'bandpass';
  filter.frequency.value = 800;
  filter.Q.value         = 2;

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start();
  src.stop(ctx.currentTime + 0.4);
}

function playChime(ctx, vol, freqs) {
  freqs.forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type   = 'sine';
    osc.frequency.value = freq;
    const t    = ctx.currentTime + i * 0.12;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol * 0.3, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.5);
  });
}

function playFanfare(ctx, vol) {
  const notes = [523, 659, 784, 1047, 784, 1047, 1319];
  notes.forEach((freq, i) => {
    const osc   = ctx.createOscillator();
    const gain  = ctx.createGain();
    osc.type    = 'sawtooth';
    osc.frequency.value = freq;
    const t     = ctx.currentTime + i * 0.1;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol * 0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    const filter = ctx.createBiquadFilter();
    filter.type  = 'lowpass';
    filter.frequency.value = 2000;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.35);
  });
}

muteBtn.addEventListener('click', toggleMute);
function toggleMute() {
  muted         = !muted;
  muteBtn.textContent = muted ? '🔇' : '🔊';
}

// ============================================================
// 12. DEBUG HUD
// ============================================================
let hudVisible = false;
const hud      = document.getElementById('debug-hud');

function updateHUD(key, value) {
  const el = document.getElementById(`hud-${key}`);
  if (el) el.textContent = `${key.toUpperCase()}: ${value}`;
}

function toggleHUD() {
  hudVisible = !hudVisible;
  hud.classList.toggle('hidden', !hudVisible);
}

// ============================================================
// 13. KEYBOARD SHORTCUTS
// ============================================================
const MOCK_NAMES  = ['CoolViewer','TikFan99','LiveLover','StarGazer','NightOwl','ProGamer','SunRiser','MoonChild'];
const MOCK_SEEDS  = ['Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta','Iota','Kappa'];
const MOCK_GIFTS  = { print: 'Rose', big: 'Doughnut', vip: 'Legendary VIP' };
const MOCK_DIAMONDS = { print: 1, big: 30, vip: 500 };

function randomMockJob(tier) {
  const name = MOCK_NAMES[Math.floor(Math.random() * MOCK_NAMES.length)];
  const seed = MOCK_SEEDS[Math.floor(Math.random() * MOCK_SEEDS.length)];
  return {
    type:     'print_job',
    user:     name,
    avatar:   `https://api.dicebear.com/9.x/avataaars/svg?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc`,
    tier,
    gift:     MOCK_GIFTS[tier],
    gift_id:  0,
    count:    1,
    diamonds: MOCK_DIAMONDS[tier],
  };
}

document.addEventListener('keydown', (e) => {
  // Don't fire if modifier keys are held
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  switch (e.key) {
    case '1':
      enqueuePrintJob(randomMockJob('print'));
      break;
    case '2':
      enqueuePrintJob(randomMockJob('big'));
      break;
    case '3':
      enqueuePrintJob(randomMockJob('vip'));
      break;
    case '4':
      // Burst of 5 mixed gifts
      for (let i = 0; i < 5; i++) {
        const tiers  = ['print','print','print','big','vip'];
        const tier   = tiers[Math.floor(Math.random() * tiers.length)];
        setTimeout(() => enqueuePrintJob(randomMockJob(tier)), i * 150);
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

// ============================================================
// 14. UTILITY
// ============================================================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 15. BOOT
// ============================================================
(async function boot() {
  await fetchConfig();
  updateHUD('ws', '🔴 Offline');
  updateHUD('queue', 'Queue: 0');
  updateHUD('fps', 'FPS: —');

  // Connect WebSocket (with graceful fallback if server is down)
  connectWS();

  console.log('%c🖨️ TikTok Printer Live', 'font-size:20px;color:#7af;font-weight:bold');
  console.log('%cKeys: 1=Print  2=Big  3=VIP  4=Burst  H=HUD  M=Mute', 'color:#aaa');
})();
