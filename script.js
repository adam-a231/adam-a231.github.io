(function(){
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const scoreVal = document.getElementById('scoreVal');
  const speedVal = document.getElementById('speedVal');
  const finalScoreEl = document.getElementById('finalScore');
  const bestScoreEl = document.getElementById('bestScore');
  const h1 = overlay.querySelector('h1');
  const pTag = overlay.querySelector('p');

  let W, H, ROAD_LEFT, ROAD_RIGHT, LANE_W, LANE_COUNT = 4;

  function resize(){
    const maxW = Math.min(window.innerWidth, 900);
    const maxH = window.innerHeight;
    W = maxW;
    H = maxH;
    canvas.width = W;
    canvas.height = H;
    const roadW = Math.min(W * 0.82, 620);
    ROAD_LEFT = (W - roadW) / 2;
    ROAD_RIGHT = ROAD_LEFT + roadW;
    LANE_W = roadW / LANE_COUNT;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- input ----------
  const keys = { w:false, s:false, a:false, d:false };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') keys.w = true;
    if (k === 's' || k === 'arrowdown') keys.s = true;
    if (k === 'a' || k === 'arrowleft') keys.a = true;
    if (k === 'd' || k === 'arrowright') keys.d = true;
    if (k === ' ' && gameState !== 'running') startGame();
    if (k === 'r') { startGame(); }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') keys.w = false;
    if (k === 's' || k === 'arrowdown') keys.s = false;
    if (k === 'a' || k === 'arrowleft') keys.a = false;
    if (k === 'd' || k === 'arrowright') keys.d = false;
  });

  function bindHold(id, key){
    const el = document.getElementById(id);
    const on = (e) => { e.preventDefault(); keys[key] = true; };
    const off = (e) => { e.preventDefault(); keys[key] = false; };
    el.addEventListener('touchstart', on);
    el.addEventListener('touchend', off);
    el.addEventListener('touchcancel', off);
    el.addEventListener('mousedown', on);
    el.addEventListener('mouseup', off);
    el.addEventListener('mouseleave', off);
  }
  bindHold('btnGas','w');
  bindHold('btnBrake','s');
  bindHold('btnLeft','a');
  bindHold('btnRight','d');

  // ---------- game state ----------
  let gameState = 'menu'; // menu | running | over
  let bestDistance = 0;

  const player = {
    laneX: 0,        // -1.5 .. 1.5 fractional lane offset from center
    x: 0,             // actual px, smoothed
    y: 0,
    w: 40,
    h: 72,
    speed: 0,         // 0..maxSpeed
    maxSpeed: 480,    // px/sec equivalent "world speed"
    accel: 260,
    brakeDecel: 420,
    coastDecel: 90,
    steerVel: 0,
  };

  let traffic = [];
  let particles = [];
  let trees = [];
  let floatingTexts = [];
  let combo = 0;
  let comboResetTimer = 0;
  let dashOffset = 0;
  let distance = 0;
  let spawnTimer = 0;
  let spawnInterval = 1.1;
  let treeSpawnTimer = 0;
  let elapsed = 0;
  let shake = 0;
  let lastTime = 0;

  const carColors = ['#c94040','#4d7fc9','#c9a84d','#7fc94d','#c94dae','#8a8a94'];

  function laneCenterX(laneIndex){
    // laneIndex 0..LANE_COUNT-1
    return ROAD_LEFT + LANE_W * (laneIndex + 0.5);
  }

  function resetGame(){
    resize();
    player.laneX = LANE_COUNT / 2 - 0.5; // start centered (fractional lane units)
    player.x = laneCenterX(1.5);
    player.y = H - 130;
    player.speed = 60;
    player.steerVel = 0;
    traffic = [];
    particles = [];
    trees = [];
    floatingTexts = [];
    combo = 0;
    comboResetTimer = 0;
    dashOffset = 0;
    distance = 0;
    spawnTimer = 0;
    spawnInterval = 1.15;
    treeSpawnTimer = 0;
    elapsed = 0;
    shake = 0;

    // seed some trees already on screen so it doesn't start bare
    for (let i = 0; i < 6; i++) {
      spawnTree(Math.random() * H);
    }
  }

  function startGame(){
    resetGame();
    gameState = 'running';
    overlay.classList.add('hidden');
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function endGame(){
    gameState = 'over';
    bestDistance = Math.max(bestDistance, Math.floor(distance));
    finalScoreEl.style.display = 'block';
    finalScoreEl.textContent = 'DISTANCE: ' + Math.floor(distance) + 'm';
    bestScoreEl.textContent = 'BEST: ' + bestDistance + 'm';
    h1.textContent = 'BUSTED';
    h1.style.color = '#2b2b26';
    pTag.style.display = 'none';
    startBtn.textContent = 'TRY AGAIN';
    overlay.classList.remove('hidden');
  }

  startBtn.addEventListener('click', () => {
    pTag.style.display = 'block';
    startGame();
  });

  // ---------- spawning ----------
  function spawnCar(laneOverride, yOffset){
    const lane = laneOverride !== undefined ? laneOverride : Math.floor(Math.random() * LANE_COUNT);
    const cw = 38 + Math.random() * 10;
    const ch = 68 + Math.random() * 14;
    const difficultyBoost = Math.min(0.6, elapsed * 0.006);
    const speedMult = 0.85 + Math.random() * 0.55 + difficultyBoost;
    traffic.push({
      lane,
      targetLane: lane,
      x: laneCenterX(lane),
      y: -ch - (yOffset || 0) - Math.random() * 100,
      w: cw,
      h: ch,
      color: carColors[Math.floor(Math.random() * carColors.length)],
      speedMult,
      passed: false,
      laneChangeTimer: 1.2 + Math.random() * 2.2,
    });
  }

  function spawnWave(){
    // as the run gets longer, sometimes drop more than one car at once
    // in different lanes so the player has to actually pick a gap
    const roll = Math.random();
    const toughness = Math.min(1, elapsed / 45); // ramps up over ~45s

    let count = 1;
    if (toughness > 0.75 && roll < 0.35) count = 3;
    else if (toughness > 0.4 && roll < 0.55) count = 2;

    const lanes = [];
    for (let i = 0; i < LANE_COUNT; i++) lanes.push(i);
    // shuffle
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    // never fill every lane — always leave at least one gap
    count = Math.min(count, LANE_COUNT - 1);

    for (let i = 0; i < count; i++) {
      spawnCar(lanes[i], i * 40);
    }
  }

  // ---------- roadside trees (decorative, non-blocking) ----------
  function spawnTree(yStart){
    const side = Math.random() < 0.5 ? 'left' : 'right';
    const size = 34 + Math.random() * 26;
    const margin = 14 + Math.random() * 30;
    const x = side === 'left'
      ? ROAD_LEFT - margin - size * 0.4
      : ROAD_RIGHT + margin + size * 0.4;
    trees.push({
      x,
      y: yStart !== undefined ? yStart : -size,
      size,
    });
  }

  // ---------- particles (skid / sparks) ----------
  function spawnSkid(x, y){
    particles.push({
      x, y, life: 0.4, maxLife: 0.4,
      vx: (Math.random()-0.5) * 30,
      vy: 40 + Math.random()*30,
      size: 3 + Math.random()*3,
      color: 'rgba(224,169,42,0.8)'
    });
  }

  function spawnCrash(x, y){
    for(let i=0;i<26;i++){
      const ang = Math.random()*Math.PI*2;
      const sp = 80 + Math.random()*220;
      particles.push({
        x, y, life: 0.6+Math.random()*0.4, maxLife: 1,
        vx: Math.cos(ang)*sp, vy: Math.sin(ang)*sp,
        size: 2+Math.random()*4,
        color: Math.random() > 0.5 ? 'rgba(179,38,30,0.9)' : 'rgba(224,169,42,0.9)'
      });
    }
  }

  // ---------- update ----------
  function update(dt){
    elapsed += dt;

    // difficulty ramps — gets noticeably harder, faster
    spawnInterval = Math.max(0.22, 1.05 - elapsed * 0.02);

    // acceleration
    if (keys.w) {
      player.speed += player.accel * dt;
    } else if (keys.s) {
      player.speed -= player.brakeDecel * dt;
    } else {
      player.speed -= player.coastDecel * dt;
    }
    player.speed = Math.max(30, Math.min(player.maxSpeed, player.speed));

    // steering — snappier, more direct response (less gradual drift)
    const steerAccel = 14;
    const steerMax = 3.4;
    const steerDrag = 11;
    if (keys.a) player.steerVel -= steerAccel * dt;
    if (keys.d) player.steerVel += steerAccel * dt;
    if (!keys.a && !keys.d) {
      // drag toward zero
      player.steerVel -= player.steerVel * steerDrag * dt;
    }
    player.steerVel = Math.max(-steerMax, Math.min(steerMax, player.steerVel));
    player.laneX += player.steerVel * dt;

    const minLane = 0.5, maxLane = LANE_COUNT - 0.5;
    if (player.laneX < minLane) { player.laneX = minLane; player.steerVel = Math.max(0, player.steerVel); }
    if (player.laneX > maxLane) { player.laneX = maxLane; player.steerVel = Math.min(0, player.steerVel); }

    const targetX = laneCenterX(player.laneX - 0.5);
    player.x += (targetX - player.x) * Math.min(1, 26 * dt);

    // slight tilt-based skid particles when steering hard at speed
    if (Math.abs(player.steerVel) > 1.4 && player.speed > 120 && Math.random() < 0.6) {
      spawnSkid(player.x + (Math.random()-0.5)*14, player.y + player.h*0.4);
    }

    // distance / score
    distance += player.speed * dt * 0.05;
    scoreVal.textContent = Math.floor(distance) + 'm';
    speedVal.textContent = Math.floor(player.speed / player.maxSpeed * 220);

    // road scroll
    dashOffset += player.speed * dt;

    // spawn traffic
    spawnTimer += dt;
    if (spawnTimer > spawnInterval) {
      spawnTimer = 0;
      spawnWave();
    }

    // spawn roadside trees — sparse, "now and then" rather than constant
    treeSpawnTimer += dt;
    if (treeSpawnTimer > 1.1 + Math.random() * 1.4) {
      treeSpawnTimer = 0;
      spawnTree();
    }

    // trees scroll with the world at the same rate as the road markings
    for (let i = trees.length - 1; i >= 0; i--) {
      const t = trees[i];
      t.y += player.speed * dt;
      if (t.y - t.size > H + 40) trees.splice(i, 1);
    }

    // update traffic — moves DOWN (toward player), closing speed = player.speed + own speed
    for (let i = traffic.length - 1; i >= 0; i--) {
      const c = traffic[i];
      const closingSpeed = (player.speed * 0.9 + 260 * c.speedMult);
      c.y += closingSpeed * dt;

      // randomly decide to swerve into an adjacent lane now and then
      c.laneChangeTimer -= dt;
      if (c.laneChangeTimer <= 0) {
        c.laneChangeTimer = 1.8 + Math.random() * 2.8;
        // only swerve if it's still got room ahead of the player to react,
        // and not already mid-swerve
        if (c.y > 40 && c.y < H - 160 && c.lane === c.targetLane && Math.random() < 0.45) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          const newLane = c.lane + dir;
          if (newLane >= 0 && newLane < LANE_COUNT) {
            c.targetLane = newLane;
          }
        }
      }

      // smoothly slide toward the target lane
      const targetCarX = laneCenterX(c.targetLane);
      c.x += (targetCarX - c.x) * Math.min(1, 4.5 * dt);
      if (Math.abs(targetCarX - c.x) < 1) {
        c.x = targetCarX;
        c.lane = c.targetLane;
      }

      // headlight glare particle trail occasionally
      if (Math.random() < 0.02) {
        particles.push({
          x: c.x, y: c.y - c.h/2, life:0.25, maxLife:0.25,
          vx:0, vy:-20, size:2, color:'rgba(255,255,255,0.5)'
        });
      }

      if (c.y - c.h/2 > H + 40) {
        traffic.splice(i, 1);
        continue;
      }

      // collision (AABB with slight forgiveness)
      const dx = Math.abs(c.x - player.x);
      const dy = Math.abs(c.y - player.y);
      const pad = 6;
      if (dx < (c.w + player.w)/2 - pad && dy < (c.h + player.h)/2 - pad) {
        spawnCrash(player.x, player.y);
        shake = 18;
        gameStateCrash();
        return;
      }

      // near-miss bonus: car swept past very close without hitting
      if (!c.passed && c.y - c.h/2 > player.y + player.h/2) {
        c.passed = true;
        if (dx < (c.w + player.w)/2 + 16) {
          combo += 1;
          const bonus = 10 * combo;
          distance += bonus;
          floatingTexts.push({ x: player.x, y: player.y - 40, life: 0.8, maxLife: 0.8, text: 'CLOSE CALL +' + bonus });
          comboResetTimer = 1.4;
        } else {
          combo = 0;
        }
      }
    }

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i,1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    if (shake > 0) shake = Math.max(0, shake - dt * 40);

    if (comboResetTimer > 0) {
      comboResetTimer -= dt;
      if (comboResetTimer <= 0) combo = 0;
    }

    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const t = floatingTexts[i];
      t.life -= dt;
      t.y -= 28 * dt;
      if (t.life <= 0) floatingTexts.splice(i, 1);
    }
  }

  function gameStateCrash(){
    gameState = 'crashing';
    setTimeout(() => { endGame(); }, 380);
  }

  // ---------- draw ----------
  function drawRoad(){
    // grass either side of the road, with a subtle two-tone mow-stripe pattern
    ctx.fillStyle = '#6fa354';
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#5e9147';
    const stripeH = 90;
    const stripeOffset = dashOffset % (stripeH * 2);
    for (let y = -stripeH * 2; y < H + stripeH * 2; y += stripeH * 2) {
      ctx.fillRect(0, y + stripeOffset, ROAD_LEFT, stripeH);
      ctx.fillRect(ROAD_RIGHT, y + stripeOffset, W - ROAD_RIGHT, stripeH);
    }

    // dirt verge strip right at the road edge
    ctx.fillStyle = '#c9c2a8';
    ctx.fillRect(ROAD_LEFT - 10, 0, 10, H);
    ctx.fillRect(ROAD_RIGHT, 0, 10, H);

    // road surface
    ctx.fillStyle = '#807d78';
    ctx.fillRect(ROAD_LEFT, 0, ROAD_RIGHT-ROAD_LEFT, H);

    // shoulder lines
    ctx.strokeStyle = 'rgba(244,241,230,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ROAD_LEFT, 0); ctx.lineTo(ROAD_LEFT, H);
    ctx.moveTo(ROAD_RIGHT, 0); ctx.lineTo(ROAD_RIGHT, H);
    ctx.stroke();

    // lane dashes
    ctx.strokeStyle = 'rgba(244,241,230,0.65)';
    ctx.lineWidth = 4;
    ctx.setLineDash([28, 26]);
    for (let i = 1; i < LANE_COUNT; i++) {
      const x = ROAD_LEFT + LANE_W * i;
      ctx.beginPath();
      ctx.lineDashOffset = -dashOffset % 54;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function drawTree(x, y, size){
    ctx.save();
    ctx.translate(x, y);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(2, size*0.55, size*0.55, size*0.2, 0, 0, Math.PI*2);
    ctx.fill();
    // trunk
    ctx.fillStyle = '#6b4a2f';
    ctx.fillRect(-size*0.08, size*0.1, size*0.16, size*0.4);
    // canopy — a few flat overlapping circles, no gradient
    ctx.fillStyle = '#4a7a37';
    ctx.beginPath();
    ctx.arc(0, -size*0.15, size*0.42, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#5c8f45';
    ctx.beginPath();
    ctx.arc(-size*0.18, -size*0.05, size*0.3, 0, Math.PI*2);
    ctx.arc(size*0.2, -size*0.02, size*0.28, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  function drawCar(x, y, w, h, bodyColor, facingUp, headlights, tilt){
    ctx.save();
    ctx.translate(x, y);
    if (tilt) ctx.rotate(tilt);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(0, h*0.42, w*0.55, 8, 0, 0, Math.PI*2);
    ctx.fill();

    // body
    const grad = ctx.createLinearGradient(-w/2,0,w/2,0);
    grad.addColorStop(0, shade(bodyColor, -25));
    grad.addColorStop(0.5, bodyColor);
    grad.addColorStop(1, shade(bodyColor, -25));
    ctx.fillStyle = grad;
    roundRect(-w/2, -h/2, w, h, 8);
    ctx.fill();

    // windshield
    ctx.fillStyle = 'rgba(15,20,30,0.85)';
    const wsY = facingUp ? -h*0.22 : h*0.02;
    roundRect(-w*0.34, wsY, w*0.68, h*0.28, 4);
    ctx.fill();

    // lights
    if (headlights) {
      ctx.fillStyle = facingUp ? '#f2efe4' : '#c94040';
      const ly = facingUp ? -h/2+2 : h/2-6;
      ctx.beginPath();
      ctx.arc(-w*0.3, ly, 3.2, 0, Math.PI*2);
      ctx.arc(w*0.3, ly, 3.2, 0, Math.PI*2);
      ctx.fill();
    }

    ctx.restore();
  }

  function roundRect(x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  }

  function shade(hex, percent){
    const num = parseInt(hex.slice(1),16);
    let r = (num>>16) + percent;
    let g = ((num>>8)&0xff) + percent;
    let b = (num&0xff) + percent;
    r = Math.max(0,Math.min(255,r));
    g = Math.max(0,Math.min(255,g));
    b = Math.max(0,Math.min(255,b));
    return '#' + (0x1000000 + r*0x10000 + g*0x100 + b).toString(16).slice(1);
  }

  function draw(){
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);
    }

    drawRoad();

    // roadside trees, scenery only
    trees.forEach(t => {
      drawTree(t.x, t.y, t.size);
    });

    // particles behind cars
    particles.forEach(p => {
      const a = p.life / p.maxLife;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // traffic
    traffic.forEach(c => {
      const targetCarX = laneCenterX(c.targetLane);
      const lateralDiff = targetCarX - c.x;
      const tilt = Math.max(-0.22, Math.min(0.22, -lateralDiff * 0.02));
      drawCar(c.x, c.y, c.w, c.h, c.color, false, true, tilt);
    });

    // player
    if (gameState !== 'crashing') {
      drawCar(player.x, player.y, player.w, player.h, '#e8e2d0', true, true);
    }

    // floating near-miss text
    floatingTexts.forEach(t => {
      const a = t.life / t.maxLife;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#e0a92a';
      ctx.font = 'bold 15px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t.text, t.x, t.y);
      ctx.globalAlpha = 1;
    });
    ctx.textAlign = 'left';

    ctx.restore();
  }

  // ---------- loop ----------
  function loop(now){
    if (gameState !== 'running') {
      if (gameState === 'crashing') {
        draw();
        requestAnimationFrame(loop);
      }
      return;
    }
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // idle preview animation on menu
  function idlePreview(){
    if (gameState === 'menu') {
      resize();
      dashOffset += 2;
      player.x = laneCenterX(1.5);
      player.y = H - 130;
      draw();
    }
    requestAnimationFrame(idlePreview);
  }
  idlePreview();

})();
