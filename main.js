/* 龙虾幸存者 - 原生 Canvas 小游戏 */
(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });

  const bgImg = new Image();
  bgImg.decoding = 'async';
  let bgReady = false;
  bgImg.onload = () => { bgReady = true; };
  bgImg.onerror = () => {
    // 某些场景（如直接 file:// 打开）可能导致相对路径图片加载失败：兜底为内置背景
    const fallbackSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
        <defs>
          <linearGradient id="g0" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#061433"/>
            <stop offset="1" stop-color="#040812"/>
          </linearGradient>
          <radialGradient id="a" cx="25%" cy="20%" r="60%">
            <stop offset="0" stop-color="#6ee7ff" stop-opacity="0.18"/>
            <stop offset="1" stop-color="#6ee7ff" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="b" cx="78%" cy="35%" r="55%">
            <stop offset="0" stop-color="#57ffb0" stop-opacity="0.14"/>
            <stop offset="1" stop-color="#57ffb0" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="960" height="540" fill="url(#g0)"/>
        <rect width="960" height="540" fill="url(#a)"/>
        <rect width="960" height="540" fill="url(#b)"/>
        <g opacity="0.28">
          <circle cx="140" cy="420" r="10" fill="#c8fbff"/>
          <circle cx="180" cy="385" r="6" fill="#c8fbff"/>
          <circle cx="820" cy="150" r="9" fill="#c8fbff"/>
          <circle cx="860" cy="112" r="5" fill="#c8fbff"/>
          <circle cx="740" cy="220" r="7" fill="#c8fbff"/>
        </g>
      </svg>
    `.trim();
    bgImg.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fallbackSvg)}`;
  };
  bgImg.src = './assets/bg.svg';

  const ui = {
    hp: document.getElementById('uiHp'),
    level: document.getElementById('uiLevel'),
    xp: document.getElementById('uiXp'),
    kills: document.getElementById('uiKills'),
    score: document.getElementById('uiScore'),
    weapon: document.getElementById('uiWeapon'),
    fps: document.getElementById('pillFps'),
    time: document.getElementById('pillTime'),
    overlayPause: document.getElementById('overlayPause'),
    overlayGameOver: document.getElementById('overlayGameOver'),
    overlayDowned: document.getElementById('overlayDowned'),
    overlayStart: document.getElementById('overlayStart'),
    overlayLevelUp: document.getElementById('overlayLevelUp'),
    gameOverSummary: document.getElementById('gameOverSummary'),
    downedSummary: document.getElementById('downedSummary'),
    btnStart: document.getElementById('btnStart'),
    btnRestart: document.getElementById('btnRestart'),
    btnRevive: document.getElementById('btnRevive'),
    btnGiveUp: document.getElementById('btnGiveUp'),
    choices: document.getElementById('choices'),
  };

  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  function resizeCanvas() {
    const w = canvas.width;
    const h = canvas.height;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * DPR);
    canvas.height = Math.round(h * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resizeCanvas();

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const len = (x, y) => Math.hypot(x, y);
  const norm = (x, y) => {
    const l = Math.hypot(x, y);
    if (l < 1e-9) return { x: 0, y: 0 };
    return { x: x / l, y: y / l };
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  const KEYS = new Set();
  let justPressed = new Set();
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    KEYS.add(e.code);
    justPressed.add(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    KEYS.delete(e.code);
  });

  const GAME = {
    w: 960,
    h: 540,
    paused: false,
    gameOver: false,
    started: false,
    time: 0,
    wave: 1,
    waveT: 0,
    waveState: 'combat', // combat | break
    waveBreakT: 0,
    bossAlive: false,
    score: 0,
    kills: 0,
    camera: { x: 0, y: 0 },
    difficulty: 1,
    shake: 0,
  };

  function formatTime(t) {
    const s = Math.floor(t);
    const m = Math.floor(s / 60);
    const ss = `${s % 60}`.padStart(2, '0');
    return `${m}:${ss}`;
  }

  const player = {
    x: GAME.w / 2,
    y: GAME.h / 2,
    r: 16,
    vx: 0,
    vy: 0,
    speed: 238,
    hp: 130,
    hpMax: 130,
    iFrames: 0,
    level: 1,
    xp: 0,
    xpNeed: 25,
    magnet: 92,
    regen: 0,
    armor: 0,
    crit: 0.08,
    damageMul: 1,
    pickupMul: 1,
    goldMul: 1,
    weapons: {
      // 开局爽感：双发、略快的射速 + 更强钳击
      bubble: { lvl: 1, cd: 0, baseCd: 0.45, speed: 560, dmg: 14, pierce: 0, shots: 2 },
      pincer: { lvl: 1, cd: 0, baseCd: 1.05, range: 92, dmg: 18 },
      // 旋流改为"清杂辅助"，避免站桩通关：基础更弱，需要升级堆起来
      whirl: { lvl: 0, cd: 0, baseCd: 2.9, radius: 92, dmg: 6, duration: 0.8 },
      // 新武器：激光
      laser: { lvl: 0, cd: 0, baseCd: 3.2, width: 8, dmg: 8, duration: 0.6 },
      // 新武器：落雷
      thunder: { lvl: 0, cd: 0, baseCd: 2.5, radius: 45, dmg: 20, strikes: 3 },
    },
    revivesLeft: 1,
    downed: false,
    form: 'bigclaw', // bigclaw | gunner | whirl | titan
    vacuumT: 0,
  };

  const entities = {
    enemies: [],
    projectiles: [],
    xpOrbs: [],
    items: [],
    fx: [],
  };

  const sprites = {
    player: { normal: null, hurt: null, size: 0 },
    enemy: new Map(), // key: `${id}:${isBoss?1:0}:${r}`
  };

  const art = {
    lobsterForms: new Map(), // form -> Image
    enemies: new Map(), // id -> Image
    bosses: new Map(), // id -> Image
  };
  function loadForm(form, src) {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    art.lobsterForms.set(form, img);
  }
  loadForm('bigclaw', './assets/sprites/lobster.svg');
  loadForm('gunner', './assets/sprites/lobster_gunner.svg');
  loadForm('whirl', './assets/sprites/lobster_whirl.svg');
  loadForm('titan', './assets/sprites/lobster_titan.svg');
  function loadArt(id, src, map) {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    map.set(id, img);
  }
  loadArt('beaver', './assets/sprites/beaver.svg', art.enemies);
  loadArt('crab', './assets/sprites/crab.svg', art.enemies);
  loadArt('eel', './assets/sprites/eel.svg', art.enemies);
  loadArt('shark', './assets/sprites/shark.svg', art.enemies);
  loadArt('octopus', './assets/sprites/octopus.svg', art.bosses);
  loadArt('whale', './assets/sprites/whale.svg', art.bosses);

  function makeSpriteCanvas(size) {
    const c = document.createElement('canvas');
    c.width = size * DPR;
    c.height = size * DPR;
    const g = c.getContext('2d');
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    return { c, g };
  }

  function getPlayerSprite(hurt) {
    const baseSize = 72;
    if (sprites.player.size !== baseSize) {
      sprites.player.size = baseSize;
      sprites.player.normal = null;
      sprites.player.hurt = null;
    }
    const key = hurt ? 'hurt' : 'normal';
    if (sprites.player[key]) return sprites.player[key];

    const { c, g } = makeSpriteCanvas(baseSize);
    const cx = baseSize / 2;
    const cy = baseSize / 2;
    const r = 16;

    // shadow
    g.save();
    g.globalAlpha = 0.35;
    g.fillStyle = '#000';
    g.beginPath();
    g.ellipse(cx, cy + 12, r * 1.05, r * 0.68, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // body gradient
    const bodyG = g.createRadialGradient(cx - 8, cy - 8, 2, cx, cy, 36);
    bodyG.addColorStop(0, hurt ? '#ff9ab0' : '#ff6b86');
    bodyG.addColorStop(1, hurt ? '#ff4b6e' : '#ff2f58');
    g.fillStyle = bodyG;
    g.strokeStyle = 'rgba(255,255,255,.28)';
    g.lineWidth = 2.2;

    // tail
    g.beginPath();
    g.ellipse(cx - 18, cy + 2, 10, 9, 0.35, 0, Math.PI * 2);
    g.fill();

    // body
    g.beginPath();
    g.ellipse(cx + 2, cy + 2, 17, 14, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();

    // pincers
    g.fillStyle = hurt ? '#ff7894' : '#ff5070';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + 24, cy + 2 + s * 10, 11, 8.5, 0.2 * s, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(cx + 34, cy + 2 + s * 10, 7.5, 5.5, 0.4 * s, 0, Math.PI * 2);
      g.fill();
    }

    // eyes
    g.fillStyle = '#0a0d18';
    g.beginPath();
    g.arc(cx + 6, cy - 5, 2.6, 0, Math.PI * 2);
    g.arc(cx + 6, cy + 9, 2.6, 0, Math.PI * 2);
    g.fill();

    sprites.player[key] = c;
    return c;
  }

  function getEnemySprite(type, isBoss) {
    const r = isBoss ? Math.round(type.r * 1.05) : type.r;
    const key = `${type.id}:${isBoss ? 1 : 0}:${r}`;
    const cached = sprites.enemy.get(key);
    if (cached) return cached;

    const size = Math.round(r * 3.2);
    const { c, g } = makeSpriteCanvas(size);
    const cx = size / 2;
    const cy = size / 2;

    // shadow
    g.save();
    g.globalAlpha = 0.35;
    g.fillStyle = '#000';
    g.beginPath();
    g.ellipse(cx, cy + r * 0.85, r * 1.05, r * 0.72, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // body
    const glow = isBoss ? 0.28 : 0.18;
    const c0 = `hsl(${type.hue}, 85%, ${isBoss ? 28 : 24}%)`;
    const c1 = `hsl(${type.hue}, 90%, ${isBoss ? 52 : 46}%)`;
    const bg = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, 2, cx, cy, r * 1.9);
    bg.addColorStop(0, c1);
    bg.addColorStop(1, c0);
    g.fillStyle = bg;
    g.strokeStyle = isBoss ? 'rgba(255,239,134,.28)' : 'rgba(255,255,255,.18)';
    g.lineWidth = isBoss ? 2.8 : 2.0;
    g.beginPath();
    g.ellipse(cx, cy, r * 1.05, r * 0.9, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();

    // subtle outer glow
    g.save();
    g.globalAlpha = 0.9;
    const gg = g.createRadialGradient(cx, cy, 0, cx, cy, r * 2.5);
    gg.addColorStop(0, `rgba(110,231,255,${glow})`);
    gg.addColorStop(1, 'rgba(110,231,255,0)');
    g.fillStyle = gg;
    g.beginPath();
    g.arc(cx, cy, r * 2.5, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // emoji sticker
    g.save();
    g.font = `${Math.round(r * (isBoss ? 1.6 : 1.5))}px system-ui, "Apple Color Emoji","Segoe UI Emoji"`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.globalAlpha = 0.96;
    g.fillText(type.emoji, cx, cy + 1);
    g.restore();

    sprites.enemy.set(key, c);
    return c;
  }

  const ENEMY_TYPES = [
    { id: 'beaver', name: '海狸', emoji: '🦫', r: 15, hp: 26, speed: 105, dmg: 10, score: 7, hue: 20 },
    { id: 'crab', name: '螃蟹', emoji: '🦀', r: 14, hp: 22, speed: 120, dmg: 9, score: 6, hue: 0 },
    { id: 'eel', name: '海蛇', emoji: '🪱', r: 13, hp: 18, speed: 150, dmg: 8, score: 6, hue: 180 },
    { id: 'shark', name: '小鲨', emoji: '🦈', r: 19, hp: 55, speed: 92, dmg: 14, score: 14, hue: 210 },
  ];

  const BOSS_TYPES = [
    { id: 'octopus', name: '章鱼王', emoji: '🐙', r: 34, hp: 520, speed: 70, dmg: 22, score: 120, hue: 290 },
    { id: 'whale', name: '巨鲸', emoji: '🐋', r: 40, hp: 680, speed: 58, dmg: 26, score: 160, hue: 210 },
  ];

  function enemyStats(base, isBoss = false) {
    const w = GAME.wave;
    const t = GAME.time;
    const d = GAME.difficulty;
    const waveRamp = 1 + Math.min(3.2, w / 18) * 0.75;
    const timeRamp = 1 + Math.min(1.8, t / 120) * 0.25;
    const ramp = waveRamp * timeRamp;
    if (isBoss) {
      return {
        hp: Math.round(base.hp * (1 + w * 0.28) * (1.0 + 0.10 * d)),
        speed: base.speed * (0.98 + 0.06 * d) * (0.98 + Math.min(0.22, w / 80)),
        dmg: Math.round(base.dmg * (1 + w * 0.12) * (1.0 + 0.10 * d)),
        score: Math.round(base.score * (1 + w * 0.12)),
      };
    }
    const early = w <= 2 ? 1 : (w <= 4 ? 0.92 : 1);
    return {
      // 为“割草感”降低单体血量，但提高刷怪数量与速度
      hp: Math.round(base.hp * ramp * (0.95 + 0.06 * d) * (w <= 2 ? 0.82 : early)),
      speed: base.speed * (0.96 + 0.08 * d) * (1 + Math.min(0.62, w / 50)) * (w <= 2 ? 0.86 : 1),
      dmg: Math.round(base.dmg * (0.95 + 0.08 * d) * (1 + Math.min(0.55, w / 60)) * (w <= 2 ? 0.72 : 1)),
      score: Math.round(base.score * (1 + 0.25 * (ramp - 1))),
    };
  }

  function spawnEnemy(base = null, opts = {}) {
    const b = base || pick(ENEMY_TYPES);
    const isBoss = !!opts.isBoss;
    const st = enemyStats(b, isBoss);
    const edge = (Math.random() * 4) | 0;
    const pad = 40;
    let x = 0, y = 0;
    if (edge === 0) { x = rand(-pad, GAME.w + pad); y = -pad; }
    if (edge === 1) { x = GAME.w + pad; y = rand(-pad, GAME.h + pad); }
    if (edge === 2) { x = rand(-pad, GAME.w + pad); y = GAME.h + pad; }
    if (edge === 3) { x = -pad; y = rand(-pad, GAME.h + pad); }
    entities.enemies.push({
      type: b,
      x,
      y,
      r: b.r,
      hp: st.hp,
      hpMax: st.hp,
      speed: st.speed,
      dmg: st.dmg,
      score: st.score,
      hitCd: 0,
      knock: { x: 0, y: 0 },
      isBoss,
    });
  }

  function maybeSpawnBoss() {
    if (GAME.bossAlive) return;
    if (GAME.wave % 5 !== 0) return;
    const base = pick(BOSS_TYPES);
    spawnEnemy(base, { isBoss: true });
    GAME.bossAlive = true;
    addFloatingText(GAME.w / 2, 58, `Boss 出现：${base.name}`, '#ffef86');
    addFxRing(GAME.w / 2, 70, 'rgba(255,239,134,.22)', 180, 0.55);
  }

  function spawnWaveController(dt) {
    // 一波一波来：战斗期刷怪，短暂休息期不刷怪
    const WAVE_DURATION = 14;
    const BREAK_DURATION = 3.2;

    if (GAME.waveState === 'break') {
      GAME.waveBreakT -= dt;
      if (GAME.waveBreakT <= 0) {
        GAME.waveState = 'combat';
        GAME.waveT = 0;
        GAME.wave += 1;
        addFloatingText(GAME.w / 2, 58, `第 ${GAME.wave} 波`, '#c7f7ff');
      }
      return;
    }

    GAME.waveT += dt;
    if (GAME.waveT <= 0.05) {
      // 刚进入本波时
      maybeSpawnBoss();
    }

    // 超密集割草：怪物上限随波次快速抬升
    const aliveCap = clamp(58 + GAME.wave * 12, 70, 360);
    const target = Math.min(aliveCap, aliveCap - (GAME.bossAlive ? 10 : 0));

    // 主要刷怪：更密集，带“爆发式小群”
    const baseRate = 10.5 + GAME.wave * 1.25; // enemies/sec
    const density = baseRate * (0.95 + 0.18 * GAME.difficulty);
    GAME._spawnAcc = (GAME._spawnAcc || 0) + dt * density;

    // burst：每隔一小段时间额外来一撮
    GAME._burstT = (GAME._burstT || 0) - dt;
    if (GAME._burstT <= 0) {
      GAME._burstT = clamp(0.85 - GAME.wave * 0.01, 0.35, 0.85);
      const burstN = clamp(7 + Math.floor(GAME.wave / 2), 7, 26);
      for (let i = 0; i < burstN; i++) if (entities.enemies.length < target) spawnEnemy();
    }

    while (GAME._spawnAcc >= 1) {
      GAME._spawnAcc -= 1;
      if (entities.enemies.length >= target) break;
      spawnEnemy();
      if (Math.random() < 0.45 && entities.enemies.length < target) spawnEnemy();
      if (GAME.wave >= 6 && Math.random() < 0.55 && entities.enemies.length < target) spawnEnemy();
    }

    if (GAME.waveT >= WAVE_DURATION) {
      GAME.waveState = 'break';
      GAME.waveBreakT = BREAK_DURATION;
      addFloatingText(GAME.w / 2, 58, `波次间隙…`, 'rgba(168,177,221,.95)');
    }
  }

  function addFxRing(x, y, color, maxR, life) {
    entities.fx.push({ kind: 'ring', x, y, r: 2, maxR, life, t: 0, color });
  }

  function addFloatingText(x, y, text, color) {
    entities.fx.push({ kind: 'text', x, y, text, color, t: 0, life: 0.75 });
  }

  function addShake(power) {
    GAME.shake = Math.min(18, GAME.shake + power);
  }

  function dropXp(x, y, amount) {
    const n = clamp(Math.round(amount * player.pickupMul), 1, 8);
    for (let i = 0; i < n; i++) {
      entities.xpOrbs.push({
        x: x + rand(-8, 8),
        y: y + rand(-8, 8),
        r: 6,
        v: rand(6, 12),
        value: 1,
      });
    }
  }

  function dealDamageToEnemy(e, dmg, knockX = 0, knockY = 0, crit = false) {
    e.hp -= dmg;
    e.knock.x += knockX;
    e.knock.y += knockY;
    addFloatingText(e.x, e.y - e.r - 6, `${crit ? '暴击 ' : ''}-${dmg}`, crit ? '#ffef86' : '#b7c7ff');
    if (e.hp <= 0) {
      GAME.kills += 1;
      GAME.score += e.score;
      const isBoss = !!e.isBoss;
      dropXp(e.x, e.y, (isBoss ? 32 : 2) + Math.round(e.score / (isBoss ? 3 : 6)));
      addFxRing(e.x, e.y, isBoss ? 'rgba(255,239,134,.35)' : 'rgba(110,231,255,.35)', isBoss ? 95 : 42, isBoss ? 0.6 : 0.35);
      if (isBoss) {
        GAME.bossAlive = false;
        addFloatingText(GAME.w / 2, 58, 'Boss 已击败！', '#ffef86');
        addShake(10);
      } else {
        addShake(1.2);
      }
      return true;
    }
    return false;
  }

  function rollCrit() {
    return Math.random() < player.crit;
  }

  function fireBubble() {
    // 选最近敌人
    let best = null;
    let bestD = 1e9;
    for (const e of entities.enemies) {
      const d = (e.x - player.x) ** 2 + (e.y - player.y) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return;
    const dx = best.x - player.x;
    const dy = best.y - player.y;
    const dir = norm(dx, dy);
    const w = player.weapons.bubble;
    const spread = 0.22;
    const shots = w.shots;
    for (let i = 0; i < shots; i++) {
      const a = Math.atan2(dir.y, dir.x) + (i - (shots - 1) / 2) * spread;
      const vx = Math.cos(a) * w.speed;
      const vy = Math.sin(a) * w.speed;
      entities.projectiles.push({
        kind: 'bubble',
        x: player.x + Math.cos(a) * (player.r + 10),
        y: player.y + Math.sin(a) * (player.r + 10),
        r: 6.5,
        vx,
        vy,
        life: 1.25,
        dmg: Math.round(w.dmg * player.damageMul),
        pierceLeft: w.pierce,
      });
    }
  }

  function swingPincer() {
    // 近战扇形：对范围内最近的若干个造成伤害
    const w = player.weapons.pincer;
    const range = w.range;
    const maxHits = 2 + Math.floor(w.lvl / 2);

    const candidates = [];
    for (const e of entities.enemies) {
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d = Math.hypot(dx, dy);
      if (d <= range + e.r) candidates.push({ e, d, dx, dy });
    }
    candidates.sort((a, b) => a.d - b.d);

    const hits = candidates.slice(0, maxHits);
    if (hits.length === 0) return;

    addFxRing(player.x, player.y, 'rgba(87,255,176,.25)', range, 0.22);
    for (const c of hits) {
      const crit = rollCrit();
      const dmg = Math.round(w.dmg * player.damageMul * (crit ? 1.8 : 1));
      const n = norm(c.dx, c.dy);
      const dead = dealDamageToEnemy(c.e, dmg, n.x * 160, n.y * 160, crit);
      if (dead) c.e._dead = true;
    }
  }

  function castWhirl() {
    const w = player.weapons.whirl;
    if (w.lvl <= 0) return;
    entities.fx.push({
      kind: 'whirl',
      x: player.x,
      y: player.y,
      radius: w.radius,
      t: 0,
      life: w.duration,
      tick: 0,
      dmg: Math.round(w.dmg * player.damageMul),
    });
  }

  // 新武器：激光
  function fireLaser() {
    const w = player.weapons.laser;
    if (w.lvl <= 0) return;
    // 选最近敌人
    let best = null;
    let bestD = 1e9;
    for (const e of entities.enemies) {
      const d = (e.x - player.x) ** 2 + (e.y - player.y) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return;
    const dx = best.x - player.x;
    const dy = best.y - player.y;
    const dir = norm(dx, dy);
    // 激光效果：从玩家发出，穿透所有敌人
    entities.fx.push({
      kind: 'laser',
      x: player.x,
      y: player.y,
      dirX: dir.x,
      dirY: dir.y,
      width: w.width,
      t: 0,
      life: w.duration,
      dmg: Math.round(w.dmg * player.damageMul),
      hit: new Set(),
    });
  }

  // 新武器：落雷
  function castThunder() {
    const w = player.weapons.thunder;
    if (w.lvl <= 0) return;
    // 随机劈落
    for (let i = 0; i < w.strikes; i++) {
      const x = rand(50, GAME.w - 50);
      const y = rand(50, GAME.h - 50);
      entities.fx.push({
        kind: 'thunder',
        x,
        y,
        radius: w.radius,
        t: 0,
        life: 0.3,
        dmg: Math.round(w.dmg * player.damageMul),
      });
    }
  }

  function tryAutoAttack(dt) {
    const b = player.weapons.bubble;
    b.cd -= dt;
    if (b.cd <= 0) {
      b.cd += b.baseCd;
      fireBubble();
    }
    const p = player.weapons.pincer;
    p.cd -= dt;
    if (p.cd <= 0) {
      p.cd += p.baseCd;
      swingPincer();
    }
    const w = player.weapons.whirl;
    w.cd -= dt;
    if (w.lvl > 0 && w.cd <= 0) {
      w.cd += w.baseCd;
      castWhirl();
    }
    // 新武器：激光
    const l = player.weapons.laser;
    l.cd -= dt;
    if (l.lvl > 0 && l.cd <= 0) {
      l.cd += l.baseCd;
      fireLaser();
    }
    // 新武器：落雷
    const t = player.weapons.thunder;
    t.cd -= dt;
    if (t.lvl > 0 && t.cd <= 0) {
      t.cd += t.baseCd;
      castThunder();
    }
  }

  function addXp(v) {
    player.xp += v;
    while (player.xp >= player.xpNeed) {
      player.xp -= player.xpNeed;
      player.level += 1;
      player.xpNeed = Math.round(player.xpNeed * 1.18 + 6);
      openLevelUp();
    }
  }

  const UPGRADES = [
    {
      id: 'evo_gunner',
      name: '进化：机枪泡泡形态',
      desc: '龙虾变形！泡泡弹变成机枪：发射数 +4，冷却大幅降低，穿透 +2。',
      tag: '进化',
      can: () => player.level >= 3 && player.form === 'bigclaw',
      apply: () => {
        player.form = 'gunner';
        const b = player.weapons.bubble;
        b.shots = Math.max(b.shots, 6);
        b.baseCd = Math.min(b.baseCd, 0.16);
        b.dmg = Math.max(9, Math.round(b.dmg * 0.85));
        b.speed = Math.max(b.speed, 680);
        b.pierce = Math.max(b.pierce, 2);
        b.lvl += 2;
        // 代价：钳击弱一点
        player.weapons.pincer.dmg = Math.round(player.weapons.pincer.dmg * 0.78);
        addFloatingText(GAME.w / 2, 80, '机枪泡泡！', '#c7f7ff');
        addFxRing(player.x, player.y, 'rgba(110,231,255,.45)', 110, 0.5);
      },
    },
    {
      id: 'evo_whirl',
      name: '进化：风暴旋流形态',
      desc: '龙虾变形！永久解锁旋流并变夸张：半径大幅增加、冷却更短、伤害更高。',
      tag: '进化',
      can: () => player.level >= 3 && player.form === 'bigclaw',
      apply: () => {
        player.form = 'whirl';
        const w = player.weapons.whirl;
        w.lvl = Math.max(w.lvl, 1);
        // 仍然强，但避免“站桩通关”：更偏中距离清杂
        w.radius = Math.max(w.radius, 145);
        w.dmg = Math.max(w.dmg, 12);
        w.baseCd = Math.min(w.baseCd, 1.35);
        w.duration = Math.max(w.duration, 1.05);
        w.lvl += 2;
        // 不再额外加生存，避免站桩更强
        addFloatingText(GAME.w / 2, 80, '风暴旋流！', '#57ffb0');
        addFxRing(player.x, player.y, 'rgba(87,255,176,.45)', 130, 0.55);
      },
    },
    {
      id: 'evo_titan',
      name: '进化：巨钳泰坦形态',
      desc: '龙虾变形！巨钳碾压：钳击伤害暴涨、范围暴涨、冷却更短，击退更强。',
      tag: '进化',
      can: () => player.level >= 3 && player.form === 'bigclaw',
      apply: () => {
        player.form = 'titan';
        const p = player.weapons.pincer;
        p.dmg = Math.max(p.dmg, 60);
        p.range = Math.max(p.range, 145);
        p.baseCd = Math.min(p.baseCd, 0.72);
        p.lvl += 3;
        // 代价：泡泡弹更慢一些，主打近战
        const b = player.weapons.bubble;
        b.shots = Math.min(b.shots, 2);
        b.baseCd = Math.max(b.baseCd, 0.28);
        addFloatingText(GAME.w / 2, 80, '巨钳碾压！', '#ffef86');
        addFxRing(player.x, player.y, 'rgba(255,239,134,.40)', 140, 0.6);
      },
    },
    {
      id: 'bubble_up',
      name: '泡泡弹强化',
      desc: '泡泡弹伤害 +30%，冷却 -10%。',
      tag: '远程',
      can: () => true,
      apply: () => {
        const w = player.weapons.bubble;
        w.dmg = Math.round(w.dmg * 1.45);
        w.baseCd = Math.max(0.12, w.baseCd * 0.86);
        w.lvl += 1;
      },
    },
    {
      id: 'bubble_pierce',
      name: '泡泡穿透',
      desc: '泡泡弹可额外穿透 1 个敌人。',
      tag: '远程',
      can: () => player.weapons.bubble.pierce < 6,
      apply: () => {
        player.weapons.bubble.pierce += 1;
        player.weapons.bubble.lvl += 1;
      },
    },
    {
      id: 'bubble_shots',
      name: '泡泡分裂',
      desc: '泡泡弹数量 +2（最多 10）。',
      tag: '远程',
      can: () => player.weapons.bubble.shots < 10,
      apply: () => {
        player.weapons.bubble.shots += 2;
        player.weapons.bubble.lvl += 1;
      },
    },
    {
      id: 'pincer_up',
      name: '钳击强化',
      desc: '钳击伤害 +60%，范围 +18，冷却 -10%。',
      tag: '近战',
      can: () => true,
      apply: () => {
        const w = player.weapons.pincer;
        w.dmg = Math.round(w.dmg * 1.6);
        w.range += 18;
        w.baseCd = Math.max(0.42, w.baseCd * 0.9);
        w.lvl += 1;
      },
    },
    {
      id: 'move_speed',
      name: '甲壳冲刺',
      desc: '移动速度 +12%，拾取范围 +10。',
      tag: '机动',
      can: () => player.speed < 420,
      apply: () => {
        player.speed *= 1.12;
        player.magnet += 10;
      },
    },
    {
      id: 'max_hp',
      name: '厚甲壳',
      desc: '最大生命 +25，并立刻回复 25。',
      tag: '生存',
      can: () => player.hpMax < 260,
      apply: () => {
        player.hpMax += 25;
        player.hp = Math.min(player.hpMax, player.hp + 25);
      },
    },
    {
      id: 'regen',
      name: '盐水修复',
      desc: '每秒恢复 +0.8 生命。',
      tag: '生存',
      can: () => player.regen < 6,
      apply: () => { player.regen += 0.8; },
    },
    {
      id: 'armor',
      name: '钙化外壳',
      desc: '护甲 +1（受到伤害 -1）。',
      tag: '生存',
      can: () => player.armor < 10,
      apply: () => { player.armor += 1; },
    },
    {
      id: 'crit',
      name: '掠食直觉',
      desc: '暴击率 +6%。',
      tag: '输出',
      can: () => player.crit < 0.55,
      apply: () => { player.crit += 0.06; },
    },
    {
      id: 'damage_mul',
      name: '海底怒火',
      desc: '所有伤害 +25%。',
      tag: '输出',
      can: () => player.damageMul < 3.2,
      apply: () => { player.damageMul *= 1.25; },
    },
    {
      id: 'whirl_unlock',
      name: '潮汐旋流',
      desc: '解锁技能：旋流（围绕自身的持续伤害）。',
      tag: '技能',
      can: () => player.weapons.whirl.lvl === 0,
      apply: () => {
        player.weapons.whirl.lvl = 1;
        player.weapons.whirl.baseCd = 2.4;
      },
    },
    {
      id: 'whirl_up',
      name: '旋流强化',
      desc: '旋流半径 +16，伤害 +25%，冷却 -10%。',
      tag: '技能',
      can: () => player.weapons.whirl.lvl > 0,
      apply: () => {
        const w = player.weapons.whirl;
        w.radius += 16;
        w.dmg = Math.round(w.dmg * 1.25);
        w.baseCd = Math.max(0.7, w.baseCd * 0.9);
        w.lvl += 1;
      },
    },
    // 新武器升级选项
    {
      id: 'laser_unlock',
      name: '激光射线',
      desc: '解锁技能：激光（穿透所有敌人，持续伤害）。',
      tag: '技能',
      can: () => player.weapons.laser.lvl === 0,
      apply: () => {
        player.weapons.laser.lvl = 1;
        player.weapons.laser.baseCd = 2.8;
      },
    },
    {
      id: 'laser_up',
      name: '激光强化',
      desc: '激光伤害 +30%，宽度 +2，冷却 -10%。',
      tag: '技能',
      can: () => player.weapons.laser.lvl > 0,
      apply: () => {
        const w = player.weapons.laser;
        w.dmg = Math.round(w.dmg * 1.3);
        w.width += 2;
        w.baseCd = Math.max(0.8, w.baseCd * 0.9);
        w.lvl += 1;
      },
    },
    {
      id: 'laser_duration',
      name: '激光延长',
      desc: '激光持续时间 +0.2秒。',
      tag: '技能',
      can: () => player.weapons.laser.lvl > 0,
      apply: () => {
        player.weapons.laser.duration += 0.2;
        player.weapons.laser.lvl += 1;
      },
    },
    {
      id: 'thunder_unlock',
      name: '雷电之力',
      desc: '解锁技能：落雷（随机劈落，范围伤害）。',
      tag: '技能',
      can: () => player.weapons.thunder.lvl === 0,
      apply: () => {
        player.weapons.thunder.lvl = 1;
        player.weapons.thunder.baseCd = 2.2;
      },
    },
    {
      id: 'thunder_up',
      name: '落雷强化',
      desc: '落雷伤害 +35%，范围 +15，冷却 -10%。',
      tag: '技能',
      can: () => player.weapons.thunder.lvl > 0,
      apply: () => {
        const w = player.weapons.thunder;
        w.dmg = Math.round(w.dmg * 1.35);
        w.radius += 15;
        w.baseCd = Math.max(0.7, w.baseCd * 0.9);
        w.lvl += 1;
      },
    },
    {
      id: 'thunder_strikes',
      name: '连锁闪电',
      desc: '落雷数量 +1（最多6）。',
      tag: '技能',
      can: () => player.weapons.thunder.lvl > 0 && player.weapons.thunder.strikes < 6,
      apply: () => {
        player.weapons.thunder.strikes += 1;
        player.weapons.thunder.lvl += 1;
      },
    },
  ];

  let levelUpChoices = [];

  function openLevelUp() {
    GAME.paused = true;
    ui.overlayLevelUp.classList.remove('hidden');
    levelUpChoices = rollChoices(3);
    renderChoices(levelUpChoices);
  }

  function closeLevelUp() {
    ui.overlayLevelUp.classList.add('hidden');
    GAME.paused = false;
  }

  function rollChoices(n) {
    const pool = UPGRADES.filter((u) => u.can());
    const out = [];
    const seen = new Set();
    while (out.length < n && pool.length > 0) {
      const u = pick(pool);
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      out.push(u);
    }
    // 池子太小兜底：允许重复选择“泡泡弹强化”
    while (out.length < n) out.push(UPGRADES[0]);
    return out;
  }

  function renderChoices(choices) {
    ui.choices.innerHTML = '';
    choices.forEach((c, idx) => {
      const btn = document.createElement('button');
      btn.className = 'choice';
      btn.type = 'button';
      btn.innerHTML = `
        <div class="t">${idx + 1}. ${c.name}<span class="tag">${c.tag}</span></div>
        <div class="d">${c.desc}</div>
      `;
      btn.addEventListener('click', () => selectChoice(idx));
      ui.choices.appendChild(btn);
    });
  }

  function selectChoice(idx) {
    const c = levelUpChoices[idx];
    if (!c) return;
    c.apply();
    addFxRing(player.x, player.y, 'rgba(87,255,176,.35)', 60, 0.35);
    closeLevelUp();
  }

  function setPaused(p) {
    GAME.paused = p;
    const levelUpVisible = !ui.overlayLevelUp.classList.contains('hidden');
    const downedVisible = !ui.overlayDowned.classList.contains('hidden');
    ui.overlayPause.classList.toggle('hidden', !p || GAME.gameOver || levelUpVisible || downedVisible);
  }

  function resetGame() {
    GAME.paused = false;
    GAME.gameOver = false;
    GAME.started = true;
    GAME.time = 0;
    GAME.wave = 1;
    GAME.waveT = 0;
    GAME.waveState = 'combat';
    GAME.waveBreakT = 0;
    GAME.bossAlive = false;
    GAME.score = 0;
    GAME.kills = 0;
    GAME.difficulty = 1;
    GAME._spawnAcc = 0;
    GAME._burstT = 0;
    entities.enemies.length = 0;
    entities.projectiles.length = 0;
    entities.xpOrbs.length = 0;
    entities.items.length = 0;
    entities.fx.length = 0;

    player.x = GAME.w / 2;
    player.y = GAME.h / 2;
    player.vx = player.vy = 0;
    player.r = 16;
    player.speed = 238;
    player.hpMax = 130;
    player.hp = 130;
    // 开局保护：给玩家一点“上手时间”，并能马上割草
    player.iFrames = 4.0;
    player.level = 1;
    player.xp = 0;
    player.xpNeed = 25;
    player.magnet = 92;
    player.regen = 0;
    player.armor = 0;
    player.crit = 0.08;
    player.damageMul = 1;
    player.pickupMul = 1;
    player.goldMul = 1;
    player.weapons.bubble = { lvl: 1, cd: 0, baseCd: 0.45, speed: 560, dmg: 14, pierce: 0, shots: 2 };
    player.weapons.pincer = { lvl: 1, cd: 0, baseCd: 1.05, range: 92, dmg: 18 };
    player.weapons.whirl = { lvl: 0, cd: 0, baseCd: 2.4, radius: 120, dmg: 10, duration: 0.9 };
    player.weapons.laser = { lvl: 0, cd: 0, baseCd: 3.2, width: 8, dmg: 8, duration: 0.6 };
    player.weapons.thunder = { lvl: 0, cd: 0, baseCd: 2.5, radius: 45, dmg: 20, strikes: 3 };
    player.revivesLeft = 1;
    player.downed = false;
    player.form = 'bigclaw';
    player.vacuumT = 0;

    ui.overlayStart.classList.add('hidden');
    ui.overlayPause.classList.add('hidden');
    ui.overlayGameOver.classList.add('hidden');
    ui.overlayDowned.classList.add('hidden');
    ui.overlayLevelUp.classList.add('hidden');
  }

  function showGameOver() {
    GAME.gameOver = true;
    GAME.paused = true;
    ui.overlayPause.classList.add('hidden');
    ui.overlayLevelUp.classList.add('hidden');
    ui.overlayDowned.classList.add('hidden');
    ui.overlayGameOver.classList.remove('hidden');
    ui.gameOverSummary.textContent = `存活 ${formatTime(GAME.time)} · 击败 ${GAME.kills} · 分数 ${GAME.score}`;
  }

  function triggerDowned() {
    // 进入“击倒”状态，让玩家选择是否复活继续
    player.downed = true;
    GAME.paused = true;
    ui.overlayPause.classList.add('hidden');
    ui.overlayLevelUp.classList.add('hidden');
    ui.overlayGameOver.classList.add('hidden');
    ui.overlayDowned.classList.remove('hidden');
    ui.downedSummary.textContent =
      player.revivesLeft > 0
        ? `剩余复活次数 ${player.revivesLeft}。复活后获得 2.5 秒无敌，并小范围清场。`
        : '你已没有复活次数，只能结束本局或按 R 重开。';
    ui.btnRevive.disabled = player.revivesLeft <= 0;
  }

  function revive() {
    if (player.revivesLeft <= 0) return;
    player.revivesLeft -= 1;
    player.downed = false;
    ui.overlayDowned.classList.add('hidden');
    GAME.paused = false;

    player.hp = Math.max(1, Math.round(player.hpMax * 0.6));
    player.iFrames = Math.max(player.iFrames, 2.5);

    // 小范围清场，避免刚复活就被贴脸秒掉
    const clearR = 150;
    let cleared = 0;
    for (const e of entities.enemies) {
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if (d <= clearR + e.r) {
        e._dead = true;
        cleared += 1;
        dropXp(e.x, e.y, 2 + Math.round(e.score / 4));
      }
    }
    if (cleared > 0) {
      entities.enemies = entities.enemies.filter((e) => !e._dead);
      addFxRing(player.x, player.y, 'rgba(110,231,255,.40)', clearR, 0.35);
      addFloatingText(player.x, player.y - 30, `复活！清场 ${cleared}`, '#c7f7ff');
    } else {
      addFloatingText(player.x, player.y - 30, '复活！', '#c7f7ff');
      addFxRing(player.x, player.y, 'rgba(110,231,255,.40)', 80, 0.35);
    }
  }

  ui.btnRestart.addEventListener('click', () => resetGame());
  ui.btnRevive.addEventListener('click', () => revive());
  ui.btnGiveUp.addEventListener('click', () => showGameOver());
  ui.btnStart.addEventListener('click', () => resetGame());

  function inputVector() {
    const up = KEYS.has('KeyW') || KEYS.has('ArrowUp');
    const down = KEYS.has('KeyS') || KEYS.has('ArrowDown');
    const left = KEYS.has('KeyA') || KEYS.has('ArrowLeft');
    const right = KEYS.has('KeyD') || KEYS.has('ArrowRight');
    let x = (right ? 1 : 0) - (left ? 1 : 0);
    let y = (down ? 1 : 0) - (up ? 1 : 0);
    const n = norm(x, y);
    return n;
  }

  function update(dt) {
    if (GAME.gameOver) return;
    if (GAME.paused) return;
    if (!GAME.started) return;

    GAME.time += dt;
    // 难度轻微随等级变化
    GAME.difficulty = 1 + Math.min(2.5, (player.level - 1) / 16);

    // regen
    if (player.regen > 0) player.hp = Math.min(player.hpMax, player.hp + player.regen * dt);
    if (player.vacuumT > 0) player.vacuumT -= dt;

    // 等级体型成长：影响碰撞与贴图大小（上限避免遮挡视野）
    const baseR = 16;
    const grow = Math.min(16, Math.floor((player.level - 1) / 2)) * 0.85; // 每2级略变大
    player.r = clamp(baseR + grow, 16, 30);

    // move
    const iv = inputVector();
    const targetVx = iv.x * player.speed;
    const targetVy = iv.y * player.speed;
    player.vx = lerp(player.vx, targetVx, 1 - Math.pow(0.001, dt));
    player.vy = lerp(player.vy, targetVy, 1 - Math.pow(0.001, dt));
    player.x = clamp(player.x + player.vx * dt, player.r, GAME.w - player.r);
    player.y = clamp(player.y + player.vy * dt, player.r, GAME.h - player.r);

    if (player.iFrames > 0) player.iFrames -= dt;

    spawnWaveController(dt);
    tryAutoAttack(dt);

    // 每 5 秒怪物掉落“吸附道具”（存在怪物才掉）
    GAME._itemDropT = (GAME._itemDropT || 0) + dt;
    if (GAME._itemDropT >= 5 && entities.enemies.length > 0) {
      GAME._itemDropT = 0;
      const e = entities.enemies[(Math.random() * entities.enemies.length) | 0];
      entities.items.push({
        kind: 'vacuum',
        x: e.x + rand(-10, 10),
        y: e.y + rand(-10, 10),
        r: 10,
        t: 0,
        life: 9,
      });
      addFloatingText(e.x, e.y - 26, '掉落：吸附道具', '#ffef86');
    }

    // projectiles
    for (const p of entities.projectiles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    entities.projectiles = entities.projectiles.filter((p) => p.life > 0 && p.x > -60 && p.y > -60 && p.x < GAME.w + 60 && p.y < GAME.h + 60);

    // items
    for (const it of entities.items) {
      it.t += dt;
      it.life -= dt;
      const d = Math.hypot(player.x - it.x, player.y - it.y);
      if (d <= player.r + it.r + 6) {
        it._dead = true;
        if (it.kind === 'vacuum') {
          player.vacuumT = Math.max(player.vacuumT, 2.2);
          addFloatingText(player.x, player.y - 34, '全屏吸附！', '#ffef86');
          addFxRing(player.x, player.y, 'rgba(255,239,134,.45)', 220, 0.55);
        }
      }
    }
    entities.items = entities.items.filter((it) => !it._dead && it.life > 0);

    // fx (whirl + ring/text + laser + thunder)
    for (const f of entities.fx) {
      f.t += dt;
      if (f.kind === 'whirl') {
        f.x = player.x;
        f.y = player.y;
        f.tick -= dt;
        while (f.tick <= 0) {
          // tick 更慢，防止旋流"站桩秒全屏"
          f.tick += 0.22;
          // tick damage
          for (const e of entities.enemies) {
            const d = Math.hypot(e.x - f.x, e.y - f.y);
            if (d <= f.radius + e.r) {
              const crit = Math.random() < player.crit * 0.5;
              const dmg = Math.round(f.dmg * (crit ? 1.4 : 1));
              const n = norm(e.x - f.x, e.y - f.y);
              const dead = dealDamageToEnemy(e, dmg, n.x * 60, n.y * 60, crit);
              if (dead) e._dead = true;
            }
          }
        }
        f.life -= dt;
      } else if (f.kind === 'laser') {
        // 激光伤害：持续对路径上的敌人造成伤害
        f.tick = (f.tick || 0) - dt;
        if (f.tick <= 0) {
          f.tick = 0.1; // 每0.1秒造成一次伤害
          for (const e of entities.enemies) {
            // 检查敌人是否在激光路径上
            const dx = e.x - f.x;
            const dy = e.y - f.y;
            const proj = dx * f.dirX + dy * f.dirY;
            if (proj < 0) continue; // 敌人在激光后面
            const perpX = dx - proj * f.dirX;
            const perpY = dy - proj * f.dirY;
            const perpDist = Math.hypot(perpX, perpY);
            if (perpDist <= f.width + e.r && !f.hit.has(e)) {
              const crit = Math.random() < player.crit;
              const dmg = Math.round(f.dmg * (crit ? 1.8 : 1));
              const dead = dealDamageToEnemy(e, dmg, f.dirX * 80, f.dirY * 80, crit);
              if (dead) e._dead = true;
              f.hit.add(e);
            }
          }
        }
        f.life -= dt;
      } else if (f.kind === 'thunder') {
        // 落雷伤害：在指定位置造成范围伤害
        if (f.t >= f.life * 0.5 && !f._hit) {
          f._hit = true;
          for (const e of entities.enemies) {
            const d = Math.hypot(e.x - f.x, e.y - f.y);
            if (d <= f.radius + e.r) {
              const crit = Math.random() < player.crit * 0.7;
              const dmg = Math.round(f.dmg * (crit ? 2.0 : 1));
              const n = norm(e.x - f.x, e.y - f.y);
              const dead = dealDamageToEnemy(e, dmg, n.x * 120, n.y * 120, crit);
              if (dead) e._dead = true;
            }
          }
        }
        f.life -= dt;
      } else if (f.kind === 'ring') {
        const t = clamp(f.t / f.life, 0, 1);
        f.r = lerp(2, f.maxR, t);
      } else if (f.kind === 'text') {
        f.y -= 24 * dt;
      }
    }
    entities.fx = entities.fx.filter((f) => f.kind === 'whirl' ? f.life > 0 : f.t < f.life);

    // enemies
    for (const e of entities.enemies) {
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const n = norm(dx, dy);
      const knock = e.knock;
      e.knock.x = lerp(knock.x, 0, 1 - Math.pow(0.001, dt));
      e.knock.y = lerp(knock.y, 0, 1 - Math.pow(0.001, dt));
      e.x += (n.x * e.speed + e.knock.x) * dt;
      e.y += (n.y * e.speed + e.knock.y) * dt;
      e.hitCd -= dt;

      const d = Math.hypot(player.x - e.x, player.y - e.y);
      if (d < player.r + e.r + 2 && e.hitCd <= 0) {
        e.hitCd = 0.45;
        if (player.iFrames <= 0) {
          const raw = e.dmg;
          const reduced = Math.max(1, raw - player.armor);
          player.hp -= reduced;
          player.iFrames = 0.35;
          addFxRing(player.x, player.y, 'rgba(255,91,122,.35)', 50, 0.28);
          addFloatingText(player.x, player.y - 28, `-${reduced}`, '#ff8aa0');
          if (player.hp <= 0) {
            player.hp = 0;
            triggerDowned();
            break;
          }
        }
      }
    }

    // collisions: projectile vs enemy
    for (const p of entities.projectiles) {
      for (const e of entities.enemies) {
        if (e._dead) continue;
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d <= p.r + e.r) {
          const crit = rollCrit();
          const dmg = Math.round(p.dmg * (crit ? 1.85 : 1));
          const n = norm(e.x - p.x, e.y - p.y);
          const dead = dealDamageToEnemy(e, dmg, n.x * 110, n.y * 110, crit);
          if (dead) e._dead = true;
          if (p.pierceLeft > 0) {
            p.pierceLeft -= 1;
            // 轻微衰减
            p.dmg = Math.max(2, Math.round(p.dmg * 0.92));
          } else {
            p.life = -1;
            break;
          }
        }
      }
    }
    entities.projectiles = entities.projectiles.filter((p) => p.life > 0);
    entities.enemies = entities.enemies.filter((e) => !e._dead);

    // xp orbs magnet + pickup
    for (const o of entities.xpOrbs) {
      const dx = player.x - o.x;
      const dy = player.y - o.y;
      const d = Math.hypot(dx, dy);
      const vacuuming = player.vacuumT > 0;
      if (vacuuming || d < player.magnet) {
        const n = norm(dx, dy);
        const pull = vacuuming ? (980 + (300 - Math.min(300, d)) * 4.5) : (220 + (player.magnet - d) * 3.2);
        o.x += n.x * pull * dt;
        o.y += n.y * pull * dt;
      }
      if (d <= player.r + o.r + 2) {
        o._dead = true;
        addXp(o.value);
        GAME.score += Math.round(1 * player.goldMul);
      }
    }
    entities.xpOrbs = entities.xpOrbs.filter((o) => !o._dead);
  }

  function drawBackground() {
    ctx.save();
    ctx.fillStyle = '#081026';
    ctx.fillRect(0, 0, GAME.w, GAME.h);

    // 背景图（离线资源）——加载成功则绘制一层更有“海底”感觉的底图
    if (bgImg && bgImg.complete && (bgReady || bgImg.naturalWidth > 0 || bgImg.width > 0)) {
      ctx.globalAlpha = 0.95;
      ctx.drawImage(bgImg, 0, 0, GAME.w, GAME.h);
    }

    // 海底“涟漪网格”
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = 'rgba(110,231,255,.10)';
    ctx.lineWidth = 1;
    const step = 44;
    const t = GAME.time * 0.25;
    for (let y = -step; y <= GAME.h + step; y += step) {
      ctx.beginPath();
      for (let x = -step; x <= GAME.w + step; x += 12) {
        const yy = y + Math.sin((x * 0.04) + t) * 3.5;
        if (x === -step) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    for (let x = -step; x <= GAME.w + step; x += step) {
      ctx.beginPath();
      for (let y = -step; y <= GAME.h + step; y += 12) {
        const xx = x + Math.cos((y * 0.04) - t) * 3.5;
        if (y === -step) ctx.moveTo(xx, y);
        else ctx.lineTo(xx, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // 角落暗角
    const g = ctx.createRadialGradient(GAME.w * 0.5, GAME.h * 0.5, 120, GAME.w * 0.5, GAME.h * 0.5, 520);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, GAME.w, GAME.h);
  }

  function drawPlayer() {
    const pulse = 0.5 + 0.5 * Math.sin(GAME.time * 6);
    const hpT = player.hp / player.hpMax;
    const glow = 0.15 + 0.35 * (1 - hpT) + 0.10 * pulse;
    const x = player.x, y = player.y, r = player.r;

    // glow
    ctx.save();
    ctx.globalAlpha = 0.9;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
    g.addColorStop(0, `rgba(110,231,255,${0.22 + glow})`);
    g.addColorStop(1, 'rgba(110,231,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const hurt = player.iFrames > 0 ? 1 : 0;
    const img = art.lobsterForms.get(player.form) || art.lobsterForms.get('bigclaw');
    const imgReady = !!(img && img.complete && img.naturalWidth > 0);
    const spr = imgReady ? img : getPlayerSprite(!!hurt);
    // 体型跟等级走（上限避免遮挡）
    const scale = clamp(1 + (player.r - 16) * 0.08, 1, 1.9);
    const s = (imgReady ? 66 : 56) * scale;
    ctx.save();
    const ang = Math.atan2(player.vy, player.vx);
    ctx.translate(x, y);
    if (Math.hypot(player.vx, player.vy) > 12) ctx.rotate(ang);
    ctx.drawImage(spr, -s / 2, -s / 2, s, s);
    ctx.restore();
  }

  function drawEnemy(e) {
    const { x, y } = e;
    const r = e.r;
    const isBoss = !!e.isBoss;
    const t = GAME.time;
    const wob = Math.sin((x + y) * 0.02 + t * 4) * 0.6;

    const artMap = isBoss ? art.bosses : art.enemies;
    const img = artMap.get(e.type.id);
    const imgReady = img && img.complete && img.naturalWidth > 0;
    const spr = imgReady ? img : getEnemySprite(e.type, isBoss);
    const size = imgReady ? Math.round(r * (isBoss ? 3.0 : 2.9)) : Math.round(r * (isBoss ? 2.9 : 2.7));

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(wob * 0.12);
    ctx.drawImage(spr, -size / 2, -size / 2, size, size);

    // hp bar (动态)
    const hpT = clamp(e.hp / e.hpMax, 0, 1);
    const barW = r * (isBoss ? 2.8 : 2.0);
    const barH = isBoss ? 5.2 : 4.2;
    ctx.translate(0, -r * (isBoss ? 1.55 : 1.25));
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(-barW / 2, -barH / 2, barW, barH);
    ctx.fillStyle = isBoss ? 'rgba(255,239,134,.88)' : 'rgba(110,231,255,.82)';
    ctx.fillRect(-barW / 2, -barH / 2, barW * hpT, barH);
    ctx.restore();
  }

  function drawProjectiles() {
    for (const p of entities.projectiles) {
      if (p.kind === 'bubble') {
        const t = clamp(p.life / 1.25, 0, 1);
        ctx.save();
        ctx.globalAlpha = 0.95;
        const g = ctx.createRadialGradient(p.x - 2, p.y - 2, 1, p.x, p.y, p.r * 2.4);
        g.addColorStop(0, `rgba(110,231,255,${0.55 + 0.35 * (1 - t)})`);
        g.addColorStop(1, 'rgba(110,231,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 2.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(210,246,255,.85)';
        ctx.strokeStyle = 'rgba(255,255,255,.35)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawXpOrbs() {
    for (const o of entities.xpOrbs) {
      ctx.save();
      const g = ctx.createRadialGradient(o.x - 1.5, o.y - 1.5, 1, o.x, o.y, o.r * 2.2);
      g.addColorStop(0, 'rgba(87,255,176,.7)');
      g.addColorStop(1, 'rgba(87,255,176,0)');
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r * 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(150,255,220,.9)';
      ctx.strokeStyle = 'rgba(255,255,255,.28)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawItems() {
    for (const it of entities.items) {
      if (it.kind !== 'vacuum') continue;
      const bob = Math.sin(it.t * 6) * 3;
      const x = it.x, y = it.y + bob;
      ctx.save();
      ctx.globalAlpha = 0.95;
      const g = ctx.createRadialGradient(x, y, 0, x, y, it.r * 3.2);
      g.addColorStop(0, 'rgba(255,239,134,.75)');
      g.addColorStop(1, 'rgba(255,239,134,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, it.r * 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,239,134,.95)';
      ctx.strokeStyle = 'rgba(43,22,48,.55)';
      ctx.lineWidth = 2;
      // simple star
      const r = it.r;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI * 2 * i) / 10 - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.45;
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawFx() {
    for (const f of entities.fx) {
      if (f.kind === 'ring') {
        const t = clamp(f.t / f.life, 0, 1);
        ctx.save();
        ctx.globalAlpha = 0.8 * (1 - t);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (f.kind === 'text') {
        const t = clamp(f.t / f.life, 0, 1);
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = f.color;
        ctx.font = '13px ui-sans-serif, system-ui, -apple-system, Segoe UI, "Noto Sans SC"';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.text, f.x, f.y);
        ctx.restore();
      } else if (f.kind === 'whirl') {
        const t = clamp(f.t / (f.life + 0.0001), 0, 1);
        ctx.save();
        ctx.globalAlpha = 0.35 * (1 - t) + 0.15;
        ctx.strokeStyle = 'rgba(87,255,176,.55)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = 'rgba(110,231,255,.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius * 0.7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (f.kind === 'laser') {
        // 绘制激光
        const t = clamp(f.t / f.life, 0, 1);
        ctx.save();
        ctx.globalAlpha = 0.9 * (1 - t * 0.5);
        // 激光主光束
        ctx.strokeStyle = 'rgba(255,50,100,.95)';
        ctx.lineWidth = f.width;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.lineTo(f.x + f.dirX * 1000, f.y + f.dirY * 1000);
        ctx.stroke();
        // 激光发光效果
        ctx.strokeStyle = 'rgba(255,150,180,.6)';
        ctx.lineWidth = f.width * 2;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.lineTo(f.x + f.dirX * 1000, f.y + f.dirY * 1000);
        ctx.stroke();
        ctx.restore();
      } else if (f.kind === 'thunder') {
        // 绘制落雷
        const t = clamp(f.t / f.life, 0, 1);
        ctx.save();
        // 落雷光柱
        if (t < 0.5) {
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = 'rgba(180,220,255,.95)';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(f.x, 0);
          ctx.lineTo(f.x, f.y);
          ctx.stroke();
          // 闪电分支
          ctx.strokeStyle = 'rgba(220,240,255,.7)';
          ctx.lineWidth = 2;
          for (let i = 0; i < 3; i++) {
            const bx = f.x + rand(-20, 20);
            const by = rand(f.y * 0.3, f.y * 0.7);
            ctx.beginPath();
            ctx.moveTo(f.x, by);
            ctx.lineTo(bx, by + rand(20, 40));
            ctx.stroke();
          }
        }
        // 落雷范围指示
        ctx.globalAlpha = 0.4 * (1 - t);
        ctx.strokeStyle = 'rgba(180,220,255,.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        ctx.stroke();
        // 落雷爆炸效果
        if (t >= 0.5 && t < 0.8) {
          ctx.globalAlpha = 0.6 * (1 - (t - 0.5) / 0.3);
          ctx.fillStyle = 'rgba(255,255,200,.8)';
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.radius * (1 + (t - 0.5) * 2), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else if (f.kind === 'ring') {
        const t = clamp(f.t / f.life, 0, 1);
        ctx.save();
        ctx.globalAlpha = 0.8 * (1 - t);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawHudInCanvas() {
    // hp bar top-left
    const pad = 14;
    const barW = 250;
    const barH = 10;
    const hpT = player.hp / player.hpMax;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(pad, pad, barW, barH);
    ctx.fillStyle = hpT < 0.3 ? 'rgba(255,91,122,.95)' : 'rgba(110,231,255,.92)';
    ctx.fillRect(pad, pad, barW * clamp(hpT, 0, 1), barH);
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.strokeRect(pad, pad, barW, barH);
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.font = '12px ui-sans-serif, system-ui, -apple-system, Segoe UI';
    ctx.textBaseline = 'top';
    ctx.fillText(`HP ${Math.ceil(player.hp)}/${player.hpMax}`, pad, pad + 14);

    // xp bar bottom
    const xpT = player.xp / player.xpNeed;
    const bx = pad;
    const by = GAME.h - pad - 10;
    const bw = GAME.w - pad * 2;
    ctx.fillStyle = 'rgba(0,0,0,.30)';
    ctx.fillRect(bx, by, bw, 8);
    ctx.fillStyle = 'rgba(87,255,176,.9)';
    ctx.fillRect(bx, by, bw * clamp(xpT, 0, 1), 8);
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.strokeRect(bx, by, bw, 8);
    ctx.restore();
  }

  function render() {
    // screen shake
    ctx.save();
    if (GAME.shake > 0.01) {
      const s = GAME.shake;
      ctx.translate(rand(-s, s) * 0.25, rand(-s, s) * 0.25);
      GAME.shake *= 0.86;
    } else {
      GAME.shake = 0;
    }
    drawBackground();
    drawFx(); // behind
    drawItems();
    drawXpOrbs();
    for (const e of entities.enemies) drawEnemy(e);
    drawProjectiles();
    drawPlayer();
    drawFx(); // texts/rings on top
    drawHudInCanvas();
    ctx.restore();
  }

  function updateUi(fps) {
    ui.hp.textContent = `${Math.ceil(player.hp)}/${player.hpMax}${player.armor ? `（护甲 ${player.armor}）` : ''}`;
    ui.level.textContent = `${player.level}`;
    ui.xp.textContent = `${player.xp}/${player.xpNeed}`;
    ui.kills.textContent = `${GAME.kills}`;
    ui.score.textContent = `${GAME.score}`;
    const w = player.weapons;
    const weaponTxt = [
      `泡泡 Lv${w.bubble.lvl}`,
      `钳击 Lv${w.pincer.lvl}`,
      w.whirl.lvl > 0 ? `旋流 Lv${w.whirl.lvl}` : '旋流 未解锁',
      w.laser.lvl > 0 ? `激光 Lv${w.laser.lvl}` : '激光 未解锁',
      w.thunder.lvl > 0 ? `落雷 Lv${w.thunder.lvl}` : '落雷 未解锁',
    ].join(' · ');
    ui.weapon.textContent = weaponTxt;
    ui.fps.textContent = `FPS: ${fps.toFixed(0)}`;
    const bossTxt = GAME.bossAlive ? ' · Boss：在场' : '';
    ui.time.textContent = `时间: ${formatTime(GAME.time)} · 第${GAME.wave}波${bossTxt} · 复活:${player.revivesLeft}`;
  }

  function handleHotkeys() {
    if (!GAME.started) {
      if (justPressed.has('Enter') || justPressed.has('Space')) resetGame();
      return;
    }
    if (justPressed.has('Space')) {
      if (!GAME.gameOver && ui.overlayLevelUp.classList.contains('hidden') && ui.overlayDowned.classList.contains('hidden')) {
        setPaused(!GAME.paused);
      }
    }
    if (justPressed.has('KeyR')) {
      resetGame();
    }
    if (!ui.overlayDowned.classList.contains('hidden')) {
      if (justPressed.has('Enter') || justPressed.has('KeyY')) revive();
      if (justPressed.has('Escape') || justPressed.has('KeyN')) showGameOver();
    }
    if (!ui.overlayLevelUp.classList.contains('hidden')) {
      if (justPressed.has('Digit1')) selectChoice(0);
      if (justPressed.has('Digit2')) selectChoice(1);
      if (justPressed.has('Digit3')) selectChoice(2);
    }
  }

  // main loop with fixed dt cap
  let last = performance.now();
  let fpsS = { acc: 0, n: 0, fps: 60 };
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.033);
    last = now;
    handleHotkeys();
    update(dt);
    render();

    fpsS.acc += dt;
    fpsS.n += 1;
    if (fpsS.acc >= 0.35) {
      fpsS.fps = fpsS.n / fpsS.acc;
      fpsS.acc = 0;
      fpsS.n = 0;
      updateUi(fpsS.fps);
    }
    justPressed.clear();
    requestAnimationFrame(frame);
  }

  // click to focus
  canvas.addEventListener('pointerdown', () => canvas.focus?.());
  window.addEventListener('blur', () => {
    if (!GAME.gameOver && ui.overlayLevelUp.classList.contains('hidden')) setPaused(true);
  });

  // 初始停在开始界面
  GAME.started = false;
  GAME.paused = true;
  ui.overlayStart.classList.remove('hidden');
  ui.overlayPause.classList.add('hidden');
  ui.overlayGameOver.classList.add('hidden');
  ui.overlayDowned.classList.add('hidden');
  ui.overlayLevelUp.classList.add('hidden');
  updateUi(60);
  requestAnimationFrame(frame);
})();
