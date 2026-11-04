(() => {
  const $ = id => document.getElementById(id);
  if (!window.THREE) {
    $('startLede').textContent = '3D 그래픽을 불러오지 못했어요. 페이지를 새로고침해 주세요.';
    $('startBtn').disabled = true;
    return;
  }

  // Balance numbers from the design doc, plus the 3D world (units are roughly metres)
  const CFG = {
    speedStepSec: 5,        // every 5s ...
    speedStepMul: 1.10,     // ... everything gets 10% faster
    spawnStart: 1.2,        // one obstacle every 1.2s at first
    spawnMin: 0.5,          // never faster than one every 0.5s
    spawnStepDown: 0.07,    // interval shrinks 0.07s per speed step (reaches 0.5s at ~50s)
    lanes: 3,
    hazardsAfter: 4,        // hazards and fuel cans may show up after 4s
    tireChance: 0.16,
    grannyChance: 0.10,
    deerChance: 0.10,
    fuelChance: 0.12,
    tireSpeedMul: 1.35,     // tires roll toward you faster than traffic
    grannyWalk: 0.37,       // road widths per second (about 1.1 lanes/s)
    deerHopSec: 0.55,       // the deer's leap from the roadside into the middle lane
    fuelMax: 100,
    fuelStart: 100,         // a full tank at the start: two hops
    flyCost: 35,
    fuelRefill: 40,
    rainbowAfter: 8,        // rainbow cans can show up after 8s ...
    rainbowShare: 0.3,      // ... as 30% of fuel cans (roughly one every 25s)
    rainbowSec: 5,          // eating one keeps the car flying this long
    laneGap: 2.4,
    baseSpeed: 26,          // world units per second at the start
    spawnZ: -95,            // obstacles appear this far ahead, inside the fog
    despawnZ: 14,
    flyHeight: 3.2,
    flyDist: 14,            // a hop lasts while traffic travels 14 units: one car plus margin
  };
  const CAUSE = {
    car: '차와 부딪혔어요!',
    tire: '굴러온 바퀴에 맞았어요!',
    granny: '할머니가 깜짝 놀라셨어요!<br>길 건너는 사람은 꼭 피해 주세요.',
    deer: '고라니와 부딪혔어요!<br>야생동물이 뛰어들면 속도를 줄이세요.',
  };
  const CAR_COLORS = [
    { name: '노랑', hex: '#ffb21e' },
    { name: '빨강', hex: '#e2493b' },
    { name: '파랑', hex: '#3d7bff' },
    { name: '초록', hex: '#2fbf71' },
    { name: '흰색', hex: '#eceff4' },
    { name: '보라', hex: '#9b6bff' },
  ];
  const TRAFFIC = ['#5b7cfa', '#e6e1d3', '#3fb6a8', '#c94f6d', '#8a6cf0'];
  const ROAD_HALF = CFG.laneGap * 1.5 + 0.5;
  const PLAYER = { w: 1.7, l: 3.4 };

  const stage = $('stage'), canvas = $('road');
  const hudTime = $('hudTime'), hudScore = $('hudScore'), hudSpeed = $('hudSpeed');
  const gauge = $('gauge'), gaugeFill = $('gaugeFill');
  const startScreen = $('startScreen'), overScreen = $('overScreen'), guideScreen = $('guideScreen'), colorScreen = $('colorScreen');
  const rouletteScreen = $('rouletteScreen');
  const flash = $('flash'), toast = $('toast');
  const leftBtn = $('leftBtn'), rightBtn = $('rightBtn'), flyBtn = $('flyBtn');
  const fuelBox = $('fuelBox'), fuelFill = $('fuelFill'), fuelCount = $('fuelCount');

  // ---------- three.js scene ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const SKY = 0x2a3050;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 50, 120);
  // near plane at 0.5 (not 0.1) keeps depth precision for the far mountains, so their faces don't shimmer
  const camera = new THREE.PerspectiveCamera(58, 1, 0.5, 220);
  function addLights(s) {
    const hemi = new THREE.HemisphereLight(0xc8d6ff, 0x3a3020, 0.95);
    const sun = new THREE.DirectionalLight(0xffe2b0, 0.85);
    sun.position.set(6, 12, 8);
    s.add(hemi, sun);
    return { hemi, sun };
  }
  const lights = addLights(scene);

  const matCache = {};
  const mat = (hex, emissive = 0) => {
    const k = hex + '|' + emissive;
    return matCache[k] || (matCache[k] = new THREE.MeshLambertMaterial({ color: hex, emissive }));
  };
  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const CYL = new THREE.CylinderGeometry(1, 1, 1, 18);
  const SPH = new THREE.SphereGeometry(1, 18, 12);
  const CONE = new THREE.ConeGeometry(1, 1, 14);
  const TORUS = new THREE.TorusGeometry(0.42, 0.2, 10, 26);
  const PLANE = new THREE.PlaneGeometry(1, 1);
  function part(geo, m, sx, sy, sz, x, y, z) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    return mesh;
  }
  function canvasTex(size, paint) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    paint(c.getContext('2d'), size);
    return new THREE.CanvasTexture(c);
  }
  const blobTex = canvasTex(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(0,0,0,.55)'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });
  const glowTex = canvasTex(128, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,236,150,1)'); r.addColorStop(.35, 'rgba(255,190,60,.6)'); r.addColorStop(1, 'rgba(255,178,30,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });
  const ringTex = canvasTex(128, (g, s) => {
    g.strokeStyle = 'rgba(255,224,130,1)'; g.lineWidth = 7;
    g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2); g.stroke();
  });
  const starTex = canvasTex(64, (g, s) => {
    const c = s / 2;
    g.fillStyle = '#fff6d6';
    g.beginPath();
    g.moveTo(c, 2); g.quadraticCurveTo(c, c, s - 2, c); g.quadraticCurveTo(c, c, c, s - 2);
    g.quadraticCurveTo(c, c, 2, c); g.quadraticCurveTo(c, c, c, 2);
    g.fill();
  });
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
  function shadow(w, l) {
    const m = new THREE.Mesh(PLANE, blobMat);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(w, l, 1);
    m.position.y = 0.03;
    return m;
  }
  const glowSprite = (tex, scale) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.set(scale, scale, 1);
    return s;
  };

  // ---------- models (all face -z = forward; the camera looks at their backs from +z) ----------
  function makeCar(color, isPlayer) {
    const g = new THREE.Group();
    const body = isPlayer ? new THREE.MeshLambertMaterial({ color }) : mat(color);
    g.add(shadow(2.5, 4.6));
    g.add(part(BOX, body, 1.7, 0.55, 3.4, 0, 0.62, 0));
    g.add(part(BOX, mat('#1a1d26'), 1.42, 0.5, 1.7, 0, 1.12, 0.15));
    g.add(part(BOX, body, 1.34, 0.08, 1.5, 0, 1.4, 0.15));
    const wheelM = mat('#0c0d11');
    const wheels = [[-0.82, -1.1], [0.82, -1.1], [-0.82, 1.1], [0.82, 1.1]].map(([x, z]) => {
      const w = part(CYL, wheelM, 0.36, 0.3, 0.36, x, 0.36, z);
      w.rotation.z = Math.PI / 2;
      w.userData.x0 = x;
      g.add(w);
      return w;
    });
    const tail = mat('#ff3b30', 0xaa1100);
    g.add(part(BOX, tail, 0.42, 0.16, 0.06, -0.55, 0.72, 1.71));
    g.add(part(BOX, tail, 0.42, 0.16, 0.06, 0.55, 0.72, 1.71));
    if (isPlayer) {
      const stripe = mat('#13151b');
      g.add(part(BOX, stripe, 0.34, 0.02, 3.42, 0, 0.9, 0));
      g.add(part(BOX, stripe, 0.34, 0.02, 1.52, 0, 1.45, 0.15));
      const head = mat('#fff6d6', 0xfff0c0);
      g.add(part(BOX, head, 0.42, 0.14, 0.06, -0.55, 0.72, -1.71));
      g.add(part(BOX, head, 0.42, 0.14, 0.06, 0.55, 0.72, -1.71));
      // thruster flames, shown only while flying
      const flames = [-0.5, 0.5].map(x => {
        const f = part(CONE, mat('#ff8c1e', 0xff6a00), 0.22, 0.9, 0.22, x, 0.05, 1.2);
        f.rotation.x = Math.PI;
        f.visible = false;
        g.add(f);
        return f;
      });
      // glow under each wheel once it folds flat into a hover pad
      const pads = wheels.map(w => {
        const p = glowSprite(glowTex, 1.2);
        p.position.set(w.position.x, 0.05, w.position.z);
        p.visible = false;
        g.add(p);
        return p;
      });
      // soft headlight glow on the road ahead, switched on at night
      const beams = [-0.55, 0.55].map(x => {
        const b = glowSprite(glowTex, 2.2);
        b.position.set(x, 0.75, -2.4);
        b.visible = false;
        g.add(b);
        return b;
      });
      g.userData = { body, flames, wheels, pads, beams };
    } else {
      g.userData = { wheels };
    }
    return g;
  }

  function makeTire() {
    const g = new THREE.Group();
    g.add(shadow(1.3, 1.3));
    const spin = new THREE.Group();
    spin.position.y = 0.62;
    const ring = new THREE.Mesh(TORUS, mat('#16181f'));
    ring.rotation.y = Math.PI / 2;
    spin.add(ring);
    const hub = part(CYL, mat('#9aa0ad'), 0.3, 0.32, 0.3, 0, 0, 0);
    hub.rotation.z = Math.PI / 2;
    spin.add(hub);
    // bolts so the roll is easy to see
    spin.add(part(BOX, mat('#5d6370'), 0.36, 0.1, 0.1, 0, 0.17, 0));
    spin.add(part(BOX, mat('#5d6370'), 0.36, 0.1, 0.1, 0, -0.17, 0));
    g.add(spin);
    g.userData = { spin };
    return g;
  }

  // Crosswalk stays fixed across the road; she walks along it (forward = local +x)
  function makeGranny() {
    const root = new THREE.Group();
    const walk = new THREE.Group();
    for (let x = -ROAD_HALF + 0.6; x < ROAD_HALF - 0.3; x += 1.0) walk.add(part(BOX, mat('#ece6d4'), 0.5, 0.02, 2.4, x, 0.02, 0));
    root.add(walk);
    const fig = new THREE.Group();
    fig.add(shadow(1, 1));
    const legM = mat('#4a3b33');
    const legL = part(CYL, legM, 0.07, 0.6, 0.07, 0, 0.3, -0.1);
    const legR = part(CYL, legM, 0.07, 0.6, 0.07, 0, 0.3, 0.1);
    fig.add(legL, legR);
    fig.add(part(CYL, mat('#5a4a7a'), 0.3, 0.4, 0.3, 0, 0.66, 0));
    fig.add(part(CYL, mat('#b07ad8'), 0.27, 0.52, 0.25, 0, 1.06, 0));
    const arm = part(CYL, mat('#b07ad8'), 0.06, 0.42, 0.06, 0.2, 1.02, 0.12);
    arm.rotation.z = -0.8;
    fig.add(arm);
    fig.add(part(CYL, mat('#a06a32'), 0.03, 0.95, 0.03, 0.36, 0.5, 0.12));
    fig.add(part(SPH, mat('#f2c9a5'), 0.2, 0.2, 0.2, 0.02, 1.5, 0));
    fig.add(part(SPH, mat('#ecebf2'), 0.21, 0.15, 0.21, -0.02, 1.58, 0));
    fig.add(part(SPH, mat('#ecebf2'), 0.1, 0.1, 0.1, -0.2, 1.62, 0));
    fig.add(part(BOX, mat('#2b2b33'), 0.02, 0.06, 0.24, 0.2, 1.52, 0));   // glasses
    root.add(fig);
    root.userData = { walk, fig, legL, legR };
    return root;
  }

  // Water deer (고라니), low-poly and flat-shaded: no antlers, big round ears, high rump,
  // pale belly, slim two-part legs with dark hooves, and the two little fangs it's known for (forward = local +x)
  const ICO = new THREE.IcosahedronGeometry(1, 1);
  const NECK = new THREE.CylinderGeometry(0.09, 0.14, 1, 8);
  const LEG_UP = new THREE.CylinderGeometry(0.06, 0.045, 1, 6);
  const LEG_LO = new THREE.CylinderGeometry(0.038, 0.03, 1, 6);
  let deerMats = null;   // shared by every deer, built on first use
  function makeDeer() {
    const flatMat = c => new THREE.MeshPhongMaterial({ color: c, flatShading: true, shininess: 0 });
    deerMats = deerMats || {
      fur: flatMat('#b9895a'), furDark: flatMat('#94673f'), belly: flatMat('#ead6b4'), earIn: flatMat('#e3b892'),
      hoof: mat('#2a1f18'), black: mat('#141418'), ivory: mat('#f5f2ea'),
    };
    const { fur, furDark, belly, earIn, hoof, black, ivory } = deerMats;
    const root = new THREE.Group();
    const sh = shadow(1.9, 0.9);
    root.add(sh);
    const deer = new THREE.Group();
    // body: chest, barrel, higher rump, pale underside
    deer.add(part(ICO, fur, 0.58, 0.28, 0.26, 0, 1.0, 0));
    deer.add(part(ICO, fur, 0.3, 0.3, 0.25, 0.4, 1.02, 0));
    deer.add(part(ICO, furDark, 0.32, 0.32, 0.27, -0.4, 1.08, 0));
    deer.add(part(ICO, belly, 0.46, 0.15, 0.21, 0.02, 0.86, 0));
    deer.add(part(ICO, belly, 0.07, 0.06, 0.06, -0.7, 1.14, 0));   // tail tuft
    // neck and head with a narrow snout
    const neck = part(NECK, fur, 1, 0.56, 1, 0.6, 1.32, 0);
    neck.rotation.z = -0.55;
    deer.add(neck);
    deer.add(part(ICO, fur, 0.19, 0.15, 0.14, 0.84, 1.6, 0));
    deer.add(part(ICO, furDark, 0.13, 0.08, 0.09, 1.0, 1.54, 0));
    deer.add(part(SPH, black, 0.045, 0.04, 0.05, 1.11, 1.56, 0));
    // big round ears with a lighter inside
    [-1, 1].forEach(s => {
      const ear = part(ICO, fur, 0.07, 0.15, 0.035, 0.76, 1.8, s * 0.11);
      ear.rotation.x = s * 0.45;
      deer.add(ear);
      const inner = part(ICO, earIn, 0.045, 0.1, 0.02, 0.775, 1.8, s * 0.125);
      inner.rotation.x = s * 0.45;
      deer.add(inner);
      // dark eye with a tiny highlight
      deer.add(part(SPH, black, 0.032, 0.032, 0.032, 0.93, 1.65, s * 0.115));
      deer.add(part(SPH, ivory, 0.01, 0.01, 0.01, 0.95, 1.665, s * 0.13));
      // curved fang hanging below the upper lip
      const fang = part(CONE, ivory, 0.022, 0.17, 0.022, 0.98, 1.43, s * 0.045);
      fang.rotation.set(0, 0, Math.PI - 0.25);
      deer.add(fang);
    });
    // legs pivot at the hip/shoulder so they can splay mid-leap
    const legs = [[0.4, -0.12], [0.4, 0.12], [-0.42, -0.12], [-0.42, 0.12]].map(([x, z]) => {
      const leg = new THREE.Group();
      leg.position.set(x, 0.92, z);
      leg.add(part(LEG_UP, x > 0 ? fur : furDark, 1, 0.44, 1, 0, -0.2, 0));
      leg.add(part(LEG_LO, furDark, 1, 0.42, 1, 0, -0.62, 0));
      leg.add(part(BOX, hoof, 0.08, 0.07, 0.07, 0.01, -0.85, 0));
      deer.add(leg);
      return leg;
    });
    root.add(deer);
    root.userData = { deer, legs, sh };
    return root;
  }

  // Fuel can: spins, bobs, glows and throws off sparkles so it reads as a pickup.
  // The rainbow can gets its own material so its colour can cycle through the spectrum.
  function makeFuel(rainbow = false) {
    const root = new THREE.Group();
    root.add(shadow(1.3, 1.3));
    const can = new THREE.Group();
    can.position.y = 0.9;
    const bodyMat = rainbow ? new THREE.MeshLambertMaterial({ color: 0xff3355, emissive: 0x441122 }) : mat('#d8463b', 0x5a1208);
    can.add(part(BOX, bodyMat, 0.8, 1.0, 0.45, 0, 0, 0));
    can.add(part(BOX, mat('#a3322a'), 0.5, 0.18, 0.12, -0.1, 0.58, 0));
    can.add(part(CYL, mat('#e6e1d3'), 0.08, 0.25, 0.08, 0.25, 0.6, 0));
    [0.6, -0.6].forEach(r => {
      const x = part(BOX, mat('#ff9a8a'), 0.08, 1.0, 0.02, 0, 0, 0.235);
      x.rotation.z = r;
      can.add(x);
    });
    root.add(can);
    const glow = glowSprite(glowTex, 3.4);
    glow.position.y = 0.9;
    const ring = glowSprite(ringTex, 1.6);
    ring.position.y = 0.9;
    const sparks = [0, 1, 2, 3].map(() => { const s = glowSprite(starTex, 0.5); root.add(s); return s; });
    root.add(glow, ring);
    if (rainbow) {
      root.scale.setScalar(1.15);
      glow.scale.setScalar(4.2);
    }
    root.userData = { can, glow, ring, sparks, rainbow, bodyMat };
    return root;
  }

  // ---------- scenery: road, kerbs, dashes, trees, lamps (recycled as they pass the camera) ----------
  // road and ground get their own materials so the weather can recolor them
  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 400), new THREE.MeshLambertMaterial({ color: '#2a2e38' }));
  road.rotation.x = -Math.PI / 2;
  road.position.z = -150;
  scene.add(road);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshLambertMaterial({ color: '#2b4230' }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.02, -150);
  scene.add(ground);
  const white = mat('#ece6d4');
  [-1, 1].forEach(s => scene.add(part(BOX, white, 0.15, 0.02, 400, s * (ROAD_HALF - 0.3), 0.015, -150)));

  const RANGE = 160;
  const movers = [];
  const addMover = m => { scene.add(m); movers.push(m); };
  [-0.5, 0.5].forEach(k => {
    for (let z = 10; z > 10 - RANGE; z -= 8) addMover(part(BOX, white, 0.16, 0.02, 3, k * CFG.laneGap, 0.016, z));
  });
  for (let z = 10, i = 0; z > 10 - RANGE; z -= 2, i++) {
    const m = i % 2 ? white : mat('#d8463b');
    [-1, 1].forEach(s => addMover(part(BOX, m, 0.6, 0.18, 2, s * (ROAD_HALF + 0.3), 0.09, z)));
  }
  // Low-poly trees: tiered pines, round leafy trees and bushes, flat-shaded so each facet catches the light
  const flat = c => new THREE.MeshPhongMaterial({ color: c, flatShading: true, shininess: 0 });
  const leafMats = ['#2f6b45', '#3d7d4f', '#28583b', '#4a8a4f', '#356e3a', '#5b8f3e'].map(flat);
  const barkMat = flat('#5b4030');
  const TRUNK = new THREE.CylinderGeometry(0.1, 0.18, 1, 7);
  const PINE = new THREE.ConeGeometry(1, 1, 8);
  const LEAF = new THREE.IcosahedronGeometry(1, 0);
  function makePine(m) {
    const t = new THREE.Group();
    t.add(part(TRUNK, barkMat, 1, 1.4, 1, 0, 0.7, 0));
    [[1.35, 1.7, 1.7], [1.05, 1.5, 2.6], [0.72, 1.3, 3.4]].forEach(([r, h, y], k) => {
      const tier = part(PINE, m, r, h, r, 0, y, 0);
      tier.rotation.y = k * 0.4;
      t.add(tier);
    });
    return t;
  }
  function makeLeafy(m) {
    const t = new THREE.Group();
    t.add(part(TRUNK, barkMat, 1.2, 1.8, 1.2, 0, 0.9, 0));
    [[0, 2.5, 0, 1.15], [0.55, 2.15, 0.25, 0.8], [-0.5, 2.2, -0.2, 0.85], [0.1, 3.05, -0.1, 0.75]].forEach(([x, y, z, r]) => {
      const clump = part(LEAF, m, r, r * 0.9, r, x, y, z);
      clump.rotation.set(x, y, z);
      t.add(clump);
    });
    return t;
  }
  function makeBush(m) {
    const t = new THREE.Group();
    [[0, 0.35, 0, 0.55], [0.5, 0.3, 0.1, 0.4], [-0.45, 0.28, -0.1, 0.38]].forEach(([x, y, z, r]) => t.add(part(LEAF, m, r, r * 0.8, r, x, y, z)));
    return t;
  }
  const roadTrees = [];   // swapped for cacti in the desert
  for (let i = 0; i < 70; i++) {
    const side = i % 2 ? 1 : -1, m = leafMats[i % leafMats.length], kind = Math.random();
    const near = i % 5 < 2;   // two in five hug the roadside, the rest fill the distance
    const tree = kind < 0.5 ? makePine(m) : kind < 0.85 ? makeLeafy(m) : makeBush(m);
    tree.add(shadow(2.6, 2.6));
    const sc = 0.75 + Math.random() * 0.6;
    tree.scale.set(sc, sc * (0.9 + Math.random() * 0.25), sc);
    tree.rotation.y = Math.random() * Math.PI * 2;
    tree.position.set(side * (ROAD_HALF + (near ? 2.8 + Math.random() * 3 : 6 + Math.random() * 16)), 0, 10 - Math.random() * RANGE);
    addMover(tree);
    roadTrees.push(tree);
  }
  // Hills and dunes sit across the far road; any that would cover it get pushed to the side,
  // so the road runs on into the distance instead of stopping at a hump
  const clearOfRoad = (x, r) => (Math.abs(x) < r + ROAD_HALF + 2 ? (x < 0 ? -1 : 1) * (r + ROAD_HALF + 2) : x);

  // Each run draws one background theme; only that group is shown (see setWeather)
  const themes = { mountain: new THREE.Group(), desert: new THREE.Group() };
  Object.values(themes).forEach(g => scene.add(g));

  // Horizon: low-poly mountains (some snow-capped). They ignore the fog and take a tint
  // from the sky in setWeather instead, so they read as far away.
  const horizonMat = () => new THREE.MeshPhongMaterial({ flatShading: true, shininess: 0, fog: false });
  const mountainMats = [horizonMat(), horizonMat()];
  const mountainBase = [new THREE.Color('#4f6b5a'), new THREE.Color('#3f5a4e')];
  const capMat = horizonMat();
  const MOUNT = new THREE.ConeGeometry(1, 1, 6);
  for (let i = 0; i < 12; i++) {
    const r = 18 + Math.random() * 22, h = 16 + Math.random() * 26;
    const x = -130 + i * 23 + (Math.random() - 0.5) * 10, z = -150 - Math.random() * 30, ry = Math.random();
    const m = part(MOUNT, mountainMats[i % 2], r, h, r, x, h / 2 - 2, z);
    m.rotation.y = ry;
    themes.mountain.add(m);
    if (h > 30) {
      // the cap sits slightly proud of the slope; sharing the exact surface made the two flicker against each other
      const cap = part(MOUNT, capMat, r * 0.33, h * 0.31, r * 0.33, x, h - 2 - h * 0.155 + 0.3, z);
      cap.rotation.y = ry;
      themes.mountain.add(cap);
    }
  }
  // Desert: sand dunes, red flat-topped mesas on the horizon, and cacti in place of the roadside trees
  const duneMat = new THREE.MeshLambertMaterial({ color: '#d9b77a' });
  for (let i = 0; i < 10; i++) {
    const r = 18 + Math.random() * 16;
    const x = clearOfRoad(-130 + i * 28 + (Math.random() - 0.5) * 10, r);
    themes.desert.add(part(SPH, duneMat, r, 4 + Math.random() * 4, 10 + Math.random() * 8, x, -2, -85 - Math.random() * 30));
  }
  const mesaMats = [horizonMat(), horizonMat()];
  const mesaBase = [new THREE.Color('#c9774a'), new THREE.Color('#b0603a')];
  const MESA = new THREE.CylinderGeometry(0.85, 1, 1, 7);
  for (let i = 0; i < 9; i++) {
    const r = 10 + Math.random() * 14, h = 10 + Math.random() * 16;
    const mesa = part(MESA, mesaMats[i % 2], r, h, r * (0.6 + Math.random() * 0.4), -120 + i * 30 + (Math.random() - 0.5) * 12, h / 2 - 1, -145 - Math.random() * 35);
    mesa.rotation.y = Math.random();
    themes.desert.add(mesa);
  }
  const cactusMat = flat('#3f8a4a');
  const cacti = [];
  for (let i = 0; i < 36; i++) {
    const side = i % 2 ? 1 : -1, c = new THREE.Group(), h = 1.6 + Math.random() * 1.4;
    c.add(shadow(1.4, 1.4));
    c.add(part(CYL, cactusMat, 0.28, h, 0.28, 0, h / 2, 0));
    c.add(part(SPH, cactusMat, 0.28, 0.28, 0.28, 0, h, 0));
    [-1, 1].forEach(s => {
      if (Math.random() < 0.25) return;
      const ah = 0.5 + Math.random() * 0.6, y = h * (0.4 + Math.random() * 0.25);
      const stub = part(CYL, cactusMat, 0.17, 0.5, 0.17, s * 0.4, y, 0);
      stub.rotation.z = Math.PI / 2;
      c.add(stub);
      c.add(part(CYL, cactusMat, 0.17, ah, 0.17, s * 0.62, y + ah / 2, 0));
      c.add(part(SPH, cactusMat, 0.17, 0.17, 0.17, s * 0.62, y + ah, 0));
    });
    const sc = 0.9 + Math.random() * 0.6;
    c.scale.set(sc, sc, sc);
    c.position.set(side * (ROAD_HALF + 2.8 + Math.random() * 14), 0, 10 - Math.random() * RANGE);
    c.visible = false;
    addMover(c);
    cacti.push(c);
  }

  // Flying cars cruising over the road and fields, big enough to read as cars (forward = local +x)
  const flyerColors = ['#e8ecf2', '#ffb21e', '#3d7bff', '#e2493b', '#9b6bff'];
  const whiteGlowTex = canvasTex(128, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.4, 'rgba(235,245,255,.55)'); r.addColorStop(1, 'rgba(220,235,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });
  // A small pool: they sit hidden and one is launched across the sky every few seconds
  const flyers = [];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Group();
    // a real car (the same model as road traffic) turned to face +x, its wheels folded flat into glowing hover pads
    const car = makeCar(flyerColors[i % flyerColors.length], false);
    car.rotation.y = -Math.PI / 2;
    car.children[0].visible = false;   // no road shadow up in the air
    car.userData.wheels.forEach(w => {
      const side = Math.sign(w.userData.x0);
      w.rotation.z = Math.PI / 2 + side * (Math.PI / 2);
      w.position.x = w.userData.x0 + side * 0.3;
      w.position.y = 0.28;
      const pad = glowSprite(whiteGlowTex, 1.8);   // white hover light
      pad.position.set(w.position.x, 0.05, w.position.z);
      car.add(pad);
    });
    f.add(car);
    f.scale.setScalar(1.5 + Math.random() * 0.5);
    f.visible = false;
    f.userData = { active: false, dir: 1, speed: 0, bob: Math.random() * 6 };
    scene.add(f);
    flyers.push(f);
  }
  let flyerTimer = 3;   // seconds until the next flying car crosses
  function launchFlyer() {
    const f = flyers.find(x => !x.userData.active);
    if (!f) return;
    const u = f.userData, dir = Math.random() < 0.5 ? 1 : -1;
    u.active = true;
    u.dir = dir;
    u.speed = 16 + Math.random() * 8;
    f.rotation.y = dir > 0 ? 0 : Math.PI;
    f.position.set(-dir * 70, 9 + Math.random() * 12, -20 - Math.random() * 55);
    f.visible = true;
  }
  function animateFlyers(dt) {
    flyerTimer -= dt;
    if (flyerTimer <= 0) { launchFlyer(); flyerTimer = 5 + Math.random() * 6; }
    flyers.forEach(f => {
      const u = f.userData;
      if (!u.active) return;
      f.position.x += u.dir * u.speed * dt;
      f.position.y += Math.sin(clock * 1.5 + u.bob) * 0.6 * dt;
      f.rotation.x = Math.sin(clock * 1.2 + u.bob) * 0.1;    // gentle side-to-side roll
      f.rotation.z = 0.06;                                     // nose slightly up, like it's climbing
      if (Math.abs(f.position.x) > 72) { u.active = false; f.visible = false; }
    });
  }

  // Middle distance: rolling green hills with spinning wind turbines, and a few hot-air balloons
  const hillMat = new THREE.MeshLambertMaterial({ color: '#4c8048' });
  for (let i = 0; i < 9; i++) {
    const r = 22 + Math.random() * 14;
    const x = clearOfRoad(-110 + i * 28 + (Math.random() - 0.5) * 10, r);
    themes.mountain.add(part(SPH, hillMat, r, 7 + Math.random() * 5, 14 + Math.random() * 8, x, -3, -100 - Math.random() * 18));
  }
  const turbineWhite = mat('#eef1f5');
  const turbines = [];
  [-62, -38, -22, 26, 44, 70].forEach((x, i) => {
    const t = new THREE.Group(), z = -96 - (i % 3) * 7;
    t.add(part(CYL, turbineWhite, 0.25, 15, 0.25, 0, 7.5, 0));
    t.add(part(BOX, turbineWhite, 0.9, 0.7, 1.6, 0, 15, -0.3));
    const rotor = new THREE.Group();
    rotor.position.set(0, 15, 0.6);
    rotor.add(part(SPH, turbineWhite, 0.35, 0.35, 0.35, 0, 0, 0));
    for (let b = 0; b < 3; b++) {
      const blade = part(BOX, turbineWhite, 0.35, 6.5, 0.08, 0, 3.2, 0);
      const arm = new THREE.Group();
      arm.rotation.z = b * Math.PI * 2 / 3;
      arm.add(blade);
      rotor.add(arm);
    }
    rotor.rotation.z = Math.random() * Math.PI;
    t.add(rotor);
    t.position.set(x, 1, z);
    themes.mountain.add(t);
    turbines.push({ rotor, speed: 0.8 + Math.random() * 0.6 });
  });
  const balloonColors = ['#e2493b', '#ffb21e', '#3d7bff', '#2fbf71'];
  const balloons = [];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Group(), env = mat(balloonColors[i % balloonColors.length]);
    b.add(part(SPH, env, 2.2, 2.6, 2.2, 0, 3.4, 0));
    b.add(part(SPH, mat('#fff6d6'), 2.25, 0.5, 2.25, 0, 3.6, 0));   // pale band around the middle
    const neck = part(CONE, env, 1.2, 1.4, 1.2, 0, 0.9, 0);
    neck.rotation.x = Math.PI;
    b.add(neck);
    b.add(part(BOX, mat('#8a5a32'), 0.7, 0.55, 0.7, 0, -0.2, 0));   // basket
    b.position.set(-50 + i * 45 + Math.random() * 10, 18 + Math.random() * 8, -55 - Math.random() * 30);
    b.userData = { drift: 0.6 + Math.random() * 0.6, bob: Math.random() * 6 };
    themes.mountain.add(b);
    balloons.push(b);
  }
  function animateCountryside(dt) {
    turbines.forEach(t => { t.rotor.rotation.z += t.speed * dt; });
    balloons.forEach(b => {
      b.position.x += b.userData.drift * dt;
      b.position.y += Math.sin(clock * 0.6 + b.userData.bob) * 0.3 * dt;
      if (b.position.x > 80) b.position.x -= 160;
    });
  }


  for (let z = 10; z > 10 - RANGE; z -= 20) {
    [-1, 1].forEach(s => {
      const lamp = new THREE.Group();
      lamp.add(part(CYL, mat('#4a4f5c'), 0.07, 4.2, 0.07, 0, 2.1, 0));
      lamp.add(part(BOX, mat('#4a4f5c'), 1.0, 0.1, 0.12, -s * 0.45, 4.2, 0));
      lamp.add(part(BOX, mat('#fff1c4', 0xffd27a), 0.4, 0.12, 0.25, -s * 0.85, 4.12, 0));
      lamp.position.set(s * (ROAD_HALF + 1.2), 0, z);
      addMover(lamp);
    });
  }
  // ---------- time of day × weather: both are drawn fresh for every run ----------
  // light: how bright that time of day is, used to darken weather tints and snow at night
  const MORNING = { name: '아침', sky: 0xbfe1f6, fog: [60, 140], hemi: 1.2, sun: 1.0, sunColor: 0xffe2bf, ground: '#40723f', road: '#3c414c', light: 1 };
  const TIMES = [
    MORNING,
    { name: '낮', sky: 0x87bdf0, fog: [60, 140], hemi: 1.15, sun: 1.0, sunColor: 0xfff1d6, ground: '#3b6a3a', road: '#3a3f4a', light: 1 },
    { name: '노을', sky: 0xe98b6a, fog: [45, 125], hemi: 0.9, sun: 0.95, sunColor: 0xffb070, ground: '#3b5534', road: '#2f3340', light: 0.8 },
    { name: '저녁', sky: 0x2a3050, fog: [50, 120], hemi: 0.95, sun: 0.85, sunColor: 0xffe2b0, ground: '#2b4230', road: '#2a2e38', light: 0.55 },
    { name: '밤', sky: 0x0e1226, fog: [35, 105], hemi: 0.55, sun: 0.35, sunColor: 0x9fb4ff, ground: '#1e3024', road: '#23262f', light: 0.3, night: true },
  ];
  // mix: how much the weather's cloud tint covers the sky
  const WEATHERS = [
    { name: '맑음', mix: 0, light: 1 },
    { name: '비', tint: 0x4a5466, mix: 0.7, light: 0.75, fogMul: 0.8, precip: 'rain' },
    { name: '눈', tint: 0xb8c4d4, mix: 0.6, light: 0.95, fogMul: 0.85, precip: 'snow' },
  ];

  // Rain streaks or snowflakes: one particle cloud kept around the camera and recycled as it falls
  const PCOUNT = 1400;
  const pPos = new Float32Array(PCOUNT * 3);
  for (let i = 0; i < PCOUNT; i++) {
    pPos[i * 3] = (Math.random() - 0.5) * 30;
    pPos[i * 3 + 1] = Math.random() * 16;
    pPos[i * 3 + 2] = 10 - Math.random() * 70;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const rainTex = canvasTex(32, (g, s) => {
    const gr = g.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, 'rgba(200,220,255,0)'); gr.addColorStop(1, 'rgba(210,228,255,.95)');
    g.fillStyle = gr; g.fillRect(s / 2 - 1, 0, 2, s);
  });
  const snowTex = canvasTex(32, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.5, 'rgba(255,255,255,.7)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });
  const pMat = new THREE.PointsMaterial({ size: 0.6, map: rainTex, transparent: true, depthWrite: false });
  const precip = new THREE.Points(pGeo, pMat);
  precip.frustumCulled = false;
  precip.visible = false;
  scene.add(precip);

  let timeOfDay = TIMES[2], weather = WEATHERS[0], theme = 'mountain';
  function setWeather(t, w, th = 'mountain') {
    timeOfDay = t;
    weather = w;
    theme = th;
    Object.entries(themes).forEach(([k, g]) => { g.visible = k === th; });
    roadTrees.forEach(tr => { tr.visible = th !== 'desert'; });
    cacti.forEach(c => { c.visible = th === 'desert'; });
    const sky = new THREE.Color(t.sky);
    if (w.mix) sky.lerp(new THREE.Color(w.tint).multiplyScalar(t.light), w.mix);
    scene.background.copy(sky);
    scene.fog.color.copy(sky);
    const fog = w.fog || [t.fog[0] * (w.fogMul || 1), t.fog[1] * (w.fogMul || 1)];
    scene.fog.near = fog[0];
    scene.fog.far = fog[1];
    lights.hemi.intensity = t.hemi * w.light;
    lights.sun.intensity = t.sun * w.light;
    lights.sun.color.setHex(t.sunColor);
    const shade = 0.4 + 0.6 * t.light;
    ground.material.color.set(
      w.precip === 'snow' ? new THREE.Color('#dfe6ee').multiplyScalar(shade)
        : th === 'desert' ? new THREE.Color('#d9b77a').multiplyScalar(shade)
        : new THREE.Color(t.ground));
    const roadColor = w.precip === 'snow' ? new THREE.Color('#4a4f5a').multiplyScalar(shade) : new THREE.Color(t.road);
    if (w.precip === 'rain') roadColor.multiplyScalar(0.75);   // wet asphalt looks darker
    road.material.color.copy(roadColor);
    stage.style.background = '#' + sky.getHexString();
    // mountains fade into the sky, more so in rain and snow
    const haze = w.precip ? 0.55 : 0.3;
    mountainMats.forEach((m, i) => m.color.copy(mountainBase[i]).lerp(sky, haze));
    capMat.color.set('#f4f7fb').lerp(sky, haze * 0.8);
    // hills follow the ground: green, or white under snow
    hillMat.color.copy(ground.material.color).multiplyScalar(1.12);
    // desert tints
    duneMat.color.set('#d9b77a').multiplyScalar(shade * 1.05);
    mesaMats.forEach((m, i) => m.color.copy(mesaBase[i]).multiplyScalar(0.4 + 0.6 * t.light).lerp(sky, haze));
    // headlight glow only matters in the dark
    playerCar.userData.beams.forEach(b => { b.visible = !!t.night; });
    precip.visible = !!w.precip;
    if (w.precip) {
      pMat.map = w.precip === 'rain' ? rainTex : snowTex;
      pMat.size = w.precip === 'rain' ? 0.7 : 0.35;
      pMat.needsUpdate = true;
    }
  }
  // draw a time and a weather, never repeating the exact pair from the last run,
  // then a background that suits the weather: no rain in the desert. At night or in snow the far
  // background is left out entirely ('none') since darkness or snowy haze would only blur it anyway.
  const THEME_TO = { mountain: '산으로', desert: '사막으로' };
  // Rain and snow fog the middle distance while the far scenery ignores fog, and in the dark (evening
  // and night) the lit-up sand and peaks clash with the sky, so all of those drop the far background
  const themeFor = (t, w) => (t.light < 0.6 || w.precip ? 'none' : pick(['mountain', 'desert']));
  const themeWord = (th, t, w) => (th !== 'none' ? THEME_TO[th] : w.precip === 'snow' ? '눈길로' : w.precip === 'rain' ? '빗길로' : `${t.name}길로`);
  function drawSky() {
    let t, w;
    do { t = pick(TIMES); w = pick(WEATHERS); } while (t === timeOfDay && w === weather);
    return { t, w, th: themeFor(t, w) };
  }

  // Slot-reel intro: rattles through the weathers, slows down, and locks on the one drawn for this run
  function runRoulette(t, w, th, done) {
    const reelText = $('reelText'), reel = $('reel'), sub = $('reelSub');
    reel.classList.remove('locked');
    sub.textContent = '';
    rouletteScreen.hidden = false;
    const n = WEATHERS.length, target = WEATHERS.indexOf(w);
    let idx = Math.floor(Math.random() * n);
    let steps = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 16;
    while ((idx + steps) % n !== target) steps++;
    let i = 0;
    const show = () => {
      reelText.textContent = WEATHERS[idx % n].name;
      reelText.classList.remove('tick'); void reelText.offsetWidth; reelText.classList.add('tick');
    };
    show();
    const step = () => {
      if (i >= steps) {
        reel.classList.add('locked');
        sub.textContent = `${t.name}, ${themeWord(th, t, w)} 출발!`;
        playDing();
        setWeather(t, w, th);
        setTimeout(() => { rouletteScreen.hidden = true; done(); }, 950);
        return;
      }
      idx++; i++;
      show();
      playTick();
      setTimeout(step, 45 * Math.pow(1.1, i));   // each click a little slower, like a wheel running down
    };
    setTimeout(step, 60);
  }

  function updatePrecip(dt, roadV) {
    if (!precip.visible) return;
    const rain = weather.precip === 'rain', fall = rain ? 28 : 3.2;
    for (let i = 0; i < PCOUNT; i++) {
      const k = i * 3;
      pPos[k + 1] -= fall * dt;
      pPos[k + 2] += roadV * (rain ? 0.4 : 0.6) * dt;
      if (!rain) pPos[k] += Math.sin(clock * 1.5 + i) * 0.6 * dt;   // flakes sway as they fall
      if (pPos[k + 1] < 0 || pPos[k + 2] > 12) {
        pPos[k] = camX + (Math.random() - 0.5) * 30;
        pPos[k + 1] = 9 + Math.random() * 7;
        pPos[k + 2] = 10 - Math.random() * 70;
      }
    }
    pGeo.attributes.position.needsUpdate = true;
  }

  function scrollScenery(d) {
    for (const m of movers) {
      m.position.z += d;
      if (m.position.z > 12) m.position.z -= RANGE;
    }
  }

  // ---------- player car + color ----------
  const loadColor = () => {
    try { const c = localStorage.getItem('supercar-color'); if (CAR_COLORS.some(x => x.hex === c)) return c; } catch (e) {}
    return CAR_COLORS[0].hex;
  };
  let carColor = loadColor();
  const playerCar = makeCar(carColor, true);
  scene.add(playerCar);

  function setCarColor(hex) {
    carColor = hex;
    playerCar.userData.body.color.set(hex);
    try { localStorage.setItem('supercar-color', hex); } catch (e) {}
    document.querySelectorAll('.swatch').forEach(b => b.setAttribute('aria-checked', String(b.dataset.hex === hex)));
    $('colorDot').style.background = hex;
  }
  $('colorDot').style.background = carColor;
  CAR_COLORS.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.hex = c.hex;
    b.style.background = c.hex;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', c.name);
    b.setAttribute('aria-checked', String(c.hex === carColor));
    b.addEventListener('click', () => setCarColor(c.hex));
    $('swatches').appendChild(b);
  });

  // ---------- game state ----------
  let state = 'ready';
  const player = { lane: 1, x: 0, y: 0 };
  let obstacles = [], elapsed = 0, spawnTimer = 0, level = 0, toastTimer = 0, clock = 0;
  let flyLeft = 0, flyTotal = 1, fuel = CFG.fuelStart;   // seconds left in the air, length of this hop, fuel in the tank
  let rainbowLeft = 0, graceLeft = 0;   // rainbow flight time left; a short safe moment right after landing from it
  let camX = 0;

  const laneX = i => (i - 1) * CFG.laneGap;
  const speed = () => CFG.baseSpeed * Math.pow(CFG.speedStepMul, level);
  const spawnInterval = () => Math.max(CFG.spawnMin, CFG.spawnStart - CFG.spawnStepDown * level);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const scoreFor = seconds => Math.floor(seconds * 10);   // 10 seconds = 100 points
  const deerHop = o => Math.min(1, o.t / CFG.deerHopSec);

  function posX(o) {
    if (o.type === 'car' || o.type === 'fuel') return laneX(o.lane);
    if (o.type === 'tire') {
      const p = Math.max(0, Math.min(1, (o.z - CFG.spawnZ) / (-CFG.spawnZ * 0.75)));
      const ease = p * p * (3 - 2 * p);
      return laneX(o.lane) + (laneX(o.toLane) - laneX(o.lane)) * ease + Math.sin(o.z * 0.3) * 0.12;
    }
    if (o.type === 'deer') {
      const from = o.side * (ROAD_HALF + 2), p = deerHop(o), ease = 1 - (1 - p) * (1 - p);
      return from + (laneX(1) - from) * ease;
    }
    return o.x;
  }
  const laneOf = o => (o.type === 'deer' ? 1 : Math.max(0, Math.min(CFG.lanes - 1, Math.round(posX(o) / CFG.laneGap) + 1)));
  // Footprint on the road (width along x, length along z); null while it cannot be hit
  function footprint(o) {
    if (o.type === 'car') return { w: 1.7, l: 3.4 };
    if (o.type === 'tire') return { w: 0.8, l: 1.1 };
    if (o.type === 'granny') return { w: 0.6, l: 0.6 };
    if (o.type === 'deer') return deerHop(o) < 1 ? null : { w: 1.5, l: 0.6 };
    return { w: 1.0, l: 1.0 };
  }

  function addObstacle(o) {
    o.mesh = o.type === 'car' ? makeCar(o.color, false)
      : o.type === 'tire' ? makeTire()
      : o.type === 'granny' ? makeGranny()
      : o.type === 'deer' ? makeDeer()
      : makeFuel(o.rainbow);
    scene.add(o.mesh);
    obstacles.push(o);
    syncObstacle(o);
  }
  function clearObstacles() {
    obstacles.forEach(o => scene.remove(o.mesh));
    obstacles = [];
  }

  // Sample road so the start screen shows what's coming
  function showcase() {
    clearObstacles();
    addObstacle({ type: 'car', lane: 0, z: -30, color: TRAFFIC[0] });
    addObstacle({ type: 'granny', x: 1.4, dir: -1, z: -17, step: 0.3 });
    addObstacle({ type: 'tire', lane: 2, toLane: 2, z: -11, spin: 0 });
    addObstacle({ type: 'fuel', lane: 1, z: -40, t: 0 });
    addObstacle({ type: 'deer', side: 1, t: 1, z: -52 });
  }

  function reset() {
    clearObstacles();
    player.lane = 1; player.x = 0; player.y = 0;
    elapsed = 0; level = 0; spawnTimer = 0.6;
    flyLeft = 0; fuel = CFG.fuelStart;
    rainbowLeft = 0; graceLeft = 0;
    playerCar.userData.body.emissive.setHex(0);
    updateHud();
  }

  // Background music: browsers only allow sound after a tap, so it starts with the first game.
  // The speaker switch mutes everything (music and effects) and is remembered on this device.
  const music = new Audio('music.mp3');
  music.loop = true;
  music.volume = 0.4;
  let musicOn = true;
  try { musicOn = localStorage.getItem('supercar-music') !== 'off'; } catch (e) {}
  const soundBtn = $('soundBtn');
  function showMusicState() {
    soundBtn.classList.toggle('muted', !musicOn);
    soundBtn.setAttribute('aria-pressed', String(musicOn));
    soundBtn.setAttribute('aria-label', musicOn ? '소리 끄기' : '소리 켜기');
  }
  let musicStarted = false;   // the first game start is the tap that unlocks sound
  const playMusic = () => {
    musicStarted = true;
    if (musicOn && !document.hidden) music.play().catch(() => {});
  };
  function toggleMusic() {
    musicOn = !musicOn;
    try { localStorage.setItem('supercar-music', musicOn ? 'on' : 'off'); } catch (e) {}
    showMusicState();
    if (musicOn) playMusic(); else music.pause();
    // Drop keyboard focus: otherwise Enter (start/retry) or Space (fly) would "press" the
    // speaker again and switch the music straight back on.
    soundBtn.blur();
  }
  showMusicState();
  // Leaving the page (another app, a locked phone, another tab) pauses the music; coming back resumes it
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) music.pause();
    else if (musicStarted && musicOn) music.play().catch(() => {});
  });

  let overTimer = 0;
  function start() {
    if (state === 'play' || state === 'intro') return;
    playMusic();
    clearTimeout(overTimer);   // a restart before the Game Over card appears must not let it pop up later
    reset();
    startScreen.hidden = true;
    overScreen.hidden = true;
    guideScreen.hidden = true;
    colorScreen.hidden = true;
    rankScreen.hidden = true;
    stage.classList.remove('shake');
    // the weather roulette plays first; driving starts once it locks
    state = 'intro';
    const { t, w, th } = drawSky();
    runRoulette(t, w, th, () => { state = 'play'; });
  }

  function move(dir) {
    if (state !== 'play') return;
    const before = player.lane;
    player.lane = Math.min(CFG.lanes - 1, Math.max(0, player.lane + dir));
    if (player.lane !== before) playSwoosh();
  }

  function startRainbow() {
    rainbowLeft = CFG.rainbowSec;
    flyLeft = 0;
    boostT = 0;
    boostRing.position.x = player.x;
    playBoost();
    showToast(`무지개 비행! ${CFG.rainbowSec}초`, 1400);
  }
  const smooth = x => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

  function fly() {
    if (state !== 'play' || flyLeft > 0 || rainbowLeft > 0) return;
    if (fuel < CFG.flyCost) { showToast('연료가 부족해요!'); playNoFuel(); return; }
    fuel -= CFG.flyCost;
    // faster traffic means a shorter hop, so it always clears about one car
    flyTotal = flyLeft = Math.min(0.9, Math.max(0.4, CFG.flyDist / speed()));
    boostT = 0;
    boostRing.position.x = player.x;
    playBoost();
  }

  // Takeoff shockwave: one flat ring reused for every hop
  const boostRing = new THREE.Mesh(
    new THREE.RingGeometry(0.6, 0.95, 48),
    new THREE.MeshBasicMaterial({ color: 0xffc040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
  );
  boostRing.rotation.x = -Math.PI / 2;
  boostRing.position.y = 0.06;
  boostRing.visible = false;
  scene.add(boostRing);
  let boostT = 9;

  // "부웅": a rising engine roar plus a rush of air, synthesized so no sound file is needed.
  // The fly button press is the user gesture browsers require before audio can play.
  let actx = null;
  function audio() {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function blip(freq, dur, type = 'square', vol = 0.05, delay = 0) {
    if (!musicOn) return;
    try {
      const a = audio(), t = a.currentTime + delay;
      const o = a.createOscillator(), g = a.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(a.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* sound is a bonus */ }
  }
  // roulette: a dry click per step, then a two-note "딩!" when it locks
  const playTick = () => blip(900 + Math.random() * 200, 0.035);
  const playDing = () => { blip(880, 0.25, 'sine', 0.12); blip(1320, 0.45, 'sine', 0.1, 0.09); };

  // Filtered white noise: the base of whooshes and crashes
  function noise(dur, filterType, f0, f1, vol, q = 1) {
    if (!musicOn) return;
    try {
      const a = audio(), t = a.currentTime;
      const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = a.createBufferSource();
      src.buffer = buf;
      const f = a.createBiquadFilter();
      f.type = filterType;
      f.Q.value = q;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = a.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(a.destination);
      src.start(t); src.stop(t + dur);
    } catch (e) { /* sound is a bonus */ }
  }
  // sound effects
  const playClick = () => blip(720, 0.06, 'triangle', 0.08);
  const playSwoosh = () => noise(0.16, 'bandpass', 700, 2200, 0.12, 1.5);
  const playPickup = () => [660, 880, 1320].forEach((f, i) => blip(f, 0.18, 'sine', 0.1, i * 0.06));
  const playRainbow = () => [523, 659, 784, 988, 1175, 1568].forEach((f, i) => blip(f, 0.22, 'triangle', 0.08, i * 0.06));
  const playNoFuel = () => { blip(220, 0.12, 'square', 0.05); blip(180, 0.16, 'square', 0.05, 0.1); };
  function playCrash() {
    noise(0.6, 'lowpass', 2400, 120, 0.5, 0.8);   // crunch
    blip(110, 0.45, 'sine', 0.35);                 // thud
    blip(70, 0.6, 'sine', 0.3, 0.05);
  }

  function playBoost() {
    if (!musicOn) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime;
      const osc = actx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(70, t);
      osc.frequency.exponentialRampToValueAtTime(230, t + 0.35);
      osc.frequency.exponentialRampToValueAtTime(110, t + 0.75);
      const lp = actx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const og = actx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      osc.connect(lp); lp.connect(og); og.connect(actx.destination);
      osc.start(t); osc.stop(t + 0.85);

      const buf = actx.createBuffer(1, Math.floor(actx.sampleRate * 0.8), actx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = actx.createBufferSource();
      noise.buffer = buf;
      const bp = actx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(400, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + 0.4);
      bp.frequency.exponentialRampToValueAtTime(600, t + 0.8);
      const ng = actx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.22, t + 0.08);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      noise.connect(bp); bp.connect(ng); ng.connect(actx.destination);
      noise.start(t); noise.stop(t + 0.8);
    } catch (e) { /* sound is a bonus; the game works without it */ }
  }
  // 0 on the ground, 1 at the top of the hop. A rainbow flight rises, cruises and settles back down.
  const altitude = () => {
    if (rainbowLeft > 0) return Math.min(smooth((CFG.rainbowSec - rainbowLeft) / 0.35), smooth(rainbowLeft / 0.45));
    return flyLeft > 0 ? Math.sin(Math.PI * (1 - flyLeft / flyTotal)) : 0;
  };

  function spawn() {
    const Z = CFG.spawnZ;
    let type = 'car';
    if (elapsed > CFG.hazardsAfter) {
      const r = Math.random();
      if (r < CFG.tireChance) type = 'tire';
      else if (r < CFG.tireChance + CFG.grannyChance && !obstacles.some(o => o.type === 'granny')) type = 'granny';
      else if (r < CFG.tireChance + CFG.grannyChance + CFG.deerChance) type = 'deer';
      else if (r < CFG.tireChance + CFG.grannyChance + CFG.deerChance + CFG.fuelChance) type = 'fuel';
    }

    if (type === 'fuel') {
      // Drop the can in a lane that is clear near the spawn line so it never sits inside a car
      const busy = new Set(obstacles.filter(o => o.z < Z + 9).map(laneOf));
      const free = [0, 1, 2].filter(l => !busy.has(l));
      const rainbow = elapsed > CFG.rainbowAfter && rainbowLeft <= 0 && Math.random() < CFG.rainbowShare;
      if (free.length) { addObstacle({ type, rainbow, lane: pick(free), z: Z, t: 0 }); return; }
      type = 'car';
    }

    if (type === 'deer') {
      // It leaps into the middle lane, so skip it while that lane is busy near the spawn line
      const middleBusy = obstacles.some(o => o.type === 'deer' || (laneOf(o) === 1 && o.z < Z + 20));
      if (!middleBusy) {
        addObstacle({ type, side: Math.random() < 0.5 ? -1 : 1, t: 0, z: Z + 25 });
        showToast('고라니가 뛰어들어요!');
        return;
      }
      type = 'car';
    }

    if (type === 'granny') {
      // She walks in from one edge along a crosswalk; hold traffic briefly so she has room
      const dir = Math.random() < 0.5 ? 1 : -1;
      addObstacle({ type, dir, x: -dir * (ROAD_HALF + 0.5), z: Z + 15, step: 0 });
      showToast('할머니가 길을 건너요!');
      spawnTimer += 0.5;
      return;
    }

    // Never let obstacles line up across all lanes: if two lanes are already
    // taken near the spawn line, the new one joins one of those lanes instead.
    const nearTop = obstacles.filter(o => o.z < Z + 9 && o.type !== 'fuel');
    const taken = [...new Set(nearTop.map(laneOf))];
    let lane = Math.floor(Math.random() * CFG.lanes);
    if (taken.length >= CFG.lanes - 1 && !taken.includes(lane)) lane = pick(taken);

    if (type === 'tire') {
      // A tire may drift into a neighbouring lane, but only through lanes with no car or deer,
      // since it rolls faster than traffic and would otherwise pass straight through them.
      const blocked = new Set(obstacles.filter(o => o.type === 'car' || o.type === 'deer').map(laneOf));
      const targets = [lane - 1, lane, lane + 1].filter(l => l >= 0 && l < CFG.lanes && !blocked.has(l));
      if (!blocked.has(lane) && targets.length) {
        addObstacle({ type, lane, toLane: pick(targets), z: Z, spin: 0 });
        return;
      }
    }
    addObstacle({ type: 'car', lane, z: Z, color: pick(TRAFFIC) });
  }

  function hit() {
    return obstacles.find(o => {
      if (o.type === 'fuel') return false;
      const f = footprint(o);
      if (!f) return false;
      return Math.abs(posX(o) - player.x) < (PLAYER.w * 0.85 + f.w * 0.9) / 2 &&
             Math.abs(o.z) < (PLAYER.l * 0.85 + f.l * 0.9) / 2;
    });
  }

  // Drive over a can (on the ground or in the air) to top up the tank
  function collectFuel() {
    obstacles = obstacles.filter(o => {
      if (o.type !== 'fuel') return true;
      const got = Math.abs(posX(o) - player.x) < 1.4 && Math.abs(o.z) < 2.4;
      if (got) {
        scene.remove(o.mesh);
        if (o.rainbow) {
          startRainbow();
          playRainbow();
        } else {
          fuel = Math.min(CFG.fuelMax, fuel + CFG.fuelRefill);
          showToast(`연료 +${CFG.fuelRefill}`);
          playPickup();
        }
        fuelBox.classList.remove('gain'); void fuelBox.offsetWidth; fuelBox.classList.add('gain');
      }
      return !got;
    });
  }

  function update(dt) {
    elapsed += dt;
    const newLevel = Math.floor(elapsed / CFG.speedStepSec);
    if (newLevel !== level) { level = newLevel; showToast(); }

    const v = speed();
    scrollScenery(v * dt);
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawn(); spawnTimer += spawnInterval(); }
    for (const o of obstacles) {
      const ov = o.type === 'tire' ? v * CFG.tireSpeedMul : v;
      o.z += ov * dt;
      if (o.type === 'tire') o.spin += ov * dt / 0.62;
      if (o.type === 'granny') { o.x += o.dir * CFG.grannyWalk * ROAD_HALF * 2 * dt; o.step += dt; }
      if (o.type === 'deer') o.t += dt;
    }
    obstacles = obstacles.filter(o => {
      if (o.z < CFG.despawnZ) return true;
      scene.remove(o.mesh);
      return false;
    });

    flyLeft = Math.max(0, flyLeft - dt);
    if (rainbowLeft > 0) {
      rainbowLeft = Math.max(0, rainbowLeft - dt);
      if (rainbowLeft === 0) {
        graceLeft = 0.4;   // don't punish a landing right on top of something
        playerCar.userData.body.emissive.setHex(0);
      }
    }
    graceLeft = Math.max(0, graceLeft - dt);
    collectFuel();
    updateHud();
    const struck = flyLeft > 0 || rainbowLeft > 0 || graceLeft > 0 ? null : hit();
    if (struck) crash(struck.type);
  }

  function crash(type) {
    state = 'over';
    playCrash();
    $('cause').innerHTML = CAUSE[type] || CAUSE.car;
    flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on');
    stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake');
    lastScore = scoreFor(elapsed);
    $('finalTime').innerHTML = `버틴 시간: ${elapsed.toFixed(1)}초<small>점수 ${lastScore}점</small>`;
    // the nickname is asked for here, after the run, not before it
    saveState = 'ask';
    renderOverRank();
    overTimer = setTimeout(() => {
      if (state !== 'over') return;
      overScreen.hidden = false;
      const ask = overRank.querySelector('input');
      (ask || $('retryBtn')).focus({ preventScroll: true });
    }, 380);
  }

  function goHome() {
    clearTimeout(overTimer);
    state = 'ready';
    overScreen.hidden = true;
    guideScreen.hidden = true;
    stage.classList.remove('shake');
    reset();
    setWeather(MORNING, WEATHERS[0], 'mountain');
    showcase();
    startScreen.hidden = false;
    $('startBtn').focus({ preventScroll: true });
  }

  function updateHud() {
    hudTime.innerHTML = elapsed.toFixed(1).padStart(4, '0') + '<small>초</small>';
    hudScore.textContent = String(scoreFor(elapsed)).padStart(4, '0');
    // speedometer: world speed shown as km/h; the arc fills as the game speeds up (full at about ×3.2)
    const mul = Math.pow(CFG.speedStepMul, level), frac = Math.min(1, Math.max(0.08, (mul - 1) / 2.2));
    hudSpeed.textContent = String(Math.round(speed() * 4.5));
    gaugeFill.style.strokeDasharray = `${(frac * 100).toFixed(1)} 100`;
    gauge.classList.toggle('hot', frac > 0.6);
    gauge.setAttribute('aria-label', `속도계 ${Math.round(speed() * 4.5)}km/h`);
    fuelFill.style.width = (fuel / CFG.fuelMax * 100).toFixed(1) + '%';
    fuelBox.setAttribute('aria-valuenow', String(Math.round(fuel)));
    const hops = Math.floor(fuel / CFG.flyCost);
    const rainbow = rainbowLeft > 0;
    fuelCount.textContent = rainbow ? `무지개 ${rainbowLeft.toFixed(1)}초` : hops > 0 ? `날기 ${hops}번` : '연료 없음';
    const canFly = fuel >= CFG.flyCost;
    fuelBox.classList.toggle('low', !canFly && !rainbow);
    fuelBox.classList.toggle('rainbow', rainbow);
    flyBtn.classList.toggle('rainbow', rainbow);
    flyBtn.classList.toggle('cooling', !canFly && flyLeft <= 0 && !rainbow);
  }

  function showToast(text, ms = 900) {
    toast.textContent = text || '속도 UP ×' + Math.pow(CFG.speedStepMul, level).toFixed(2);
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('on'), ms);
  }

  // ---------- per-frame mesh updates ----------
  function animateFuel(u, t) {
    u.can.rotation.y = t * 2.2;
    u.can.position.y = 0.9 + Math.sin(t * 5) * 0.12;
    const pulse = 0.5 + 0.5 * Math.sin(t * 7);
    u.glow.material.opacity = 0.55 + 0.45 * pulse;
    u.glow.scale.setScalar(3.0 + pulse * 0.8);
    const ring = (t * 1.4) % 1;
    u.ring.scale.setScalar(1.2 + ring * 2.4);
    u.ring.material.opacity = 1 - ring;
    u.sparks.forEach((s, i) => {
      const a = t * 2.2 + i * Math.PI / 2, tw = 0.5 + 0.5 * Math.sin(t * 9 + i * 1.7);
      s.position.set(Math.cos(a) * 1.0, 0.9 + Math.sin(a * 1.3) * 0.5, Math.sin(a) * 1.0);
      s.scale.setScalar(0.25 + 0.45 * tw);
      s.material.opacity = 0.4 + 0.6 * tw;
      if (u.rainbow) s.material.color.setHSL((t * 0.6 + i / 4) % 1, 1, 0.65);
    });
    if (u.rainbow) {
      // the whole can, its halo and ring cycle through the rainbow
      const hue = (t * 0.6) % 1;
      u.bodyMat.color.setHSL(hue, 0.9, 0.55);
      u.bodyMat.emissive.setHSL(hue, 0.9, 0.22);
      u.glow.material.color.setHSL((hue + 0.15) % 1, 1, 0.6);
      u.ring.material.color.setHSL((hue + 0.5) % 1, 1, 0.6);
    }
  }

  function syncObstacle(o) {
    const m = o.mesh, u = m.userData;
    m.position.z = o.z;
    if (o.type === 'car' || o.type === 'fuel') m.position.x = posX(o);    if (o.type === 'tire') { m.position.x = posX(o); u.spin.rotation.x = o.spin; }
    if (o.type === 'fuel') animateFuel(u, clock + o.lane);
    if (o.type === 'granny') {
      u.fig.position.x = o.x;
      u.fig.rotation.y = o.dir > 0 ? 0 : Math.PI;
      const swing = Math.sin(o.step * 9) * 0.35;
      u.legL.rotation.z = swing;
      u.legR.rotation.z = -swing;
    }
    if (o.type === 'deer') {
      const p = deerHop(o), x = posX(o);
      u.deer.position.set(x, p < 1 ? Math.sin(Math.PI * p) * 2.0 : 0, 0);
      u.deer.rotation.y = o.side < 0 ? 0 : Math.PI;
      u.sh.position.x = x;
      // legs stretch out mid-leap, stand straight once landed
      const splay = p < 1 ? 0.6 : 0;
      u.legs.forEach((leg, i) => { leg.rotation.z = i < 2 ? -splay : splay; });
    }
  }

  function placeCamera(dt) {
    const aspect = camera.aspect, back = aspect < 1 ? (1 - aspect) * 11 : 0;   // pull back on tall phone screens so all three lanes fit
    camX += (player.x * 0.6 - camX) * Math.min(1, dt * 6);
    camera.position.set(camX, 4.4 + back * 0.45 + player.y * 0.35, 8.5 + back);
    camera.lookAt(camX * 0.85, 1 + player.y * 0.3, -12);
  }

  function frame(ts) {
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    clock += dt;
    if (state === 'play') {
      update(dt);
      player.x += (laneX(player.lane) - player.x) * Math.min(1, dt * 14);
    } else if (state === 'ready' || state === 'intro') {
      scrollScenery(8 * dt);
    }
    const a = altitude(), lean = laneX(player.lane) - player.x;
    player.y = a * CFG.flyHeight;
    playerCar.position.set(player.x, player.y, 0);
    playerCar.rotation.z = -lean * 0.08;
    playerCar.rotation.y = lean * 0.06;
    playerCar.rotation.x = a * 0.12;
    playerCar.scale.setScalar(1 + a * 0.12);
    const u = playerCar.userData;
    u.flames.forEach(f => {
      f.visible = a > 0;
      f.scale.y = 0.9 * (0.7 + Math.random() * 0.4);
    });
    // wheels swing outward and lie flat like hover pads at takeoff, then fold back for landing
    const fold = Math.min(1, a / 0.35);
    u.wheels.forEach((w, i) => {
      const side = Math.sign(w.userData.x0);
      w.rotation.z = Math.PI / 2 + side * (Math.PI / 2) * fold;
      w.position.x = w.userData.x0 + side * 0.3 * fold;
      w.position.y = 0.36 - 0.08 * fold;
      const pad = u.pads[i];
      pad.visible = fold > 0.05;
      pad.position.set(w.position.x, 0.05, w.position.z);
      pad.material.opacity = fold * (0.7 + Math.random() * 0.3);
      pad.scale.setScalar(1.1 + fold * 0.7);
      // rainbow flight: every hover pad glows a different colour of the rainbow
      if (rainbowLeft > 0) pad.material.color.setHSL((clock * 0.8 + i / 4) % 1, 1, 0.6);
      else pad.material.color.setHex(0xffffff);
    });
    if (rainbowLeft > 0) {
      u.body.emissive.setHSL((clock * 0.8) % 1, 0.9, 0.18);
      u.flames.forEach((f, i) => f.scale.x = f.scale.z = 0.22 * (1.3 + Math.sin(clock * 20 + i) * 0.2));
    }
    // takeoff shockwave on the road
    boostT += dt;
    boostRing.visible = boostT < 0.6;
    if (boostRing.visible) {
      const s = 1 + boostT * 7;
      boostRing.scale.set(s, s, 1);
      boostRing.material.opacity = 1 - boostT / 0.6;
    }
    // a little lens punch while airborne sells the "부웅"
    // a wide (landscape) window already shows plenty to the sides, so zoom in a little to keep the road big
    const fov = (camera.aspect > 1.3 ? 48 : 58) + 7 * fold;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    obstacles.forEach(syncObstacle);
    updatePrecip(dt, state === 'play' ? speed() : state === 'ready' || state === 'intro' ? 8 : 0);
    animateFlyers(dt);
    if (theme === 'mountain') animateCountryside(dt);    placeCamera(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }

  // ---------- obstacle guide (pictures rendered from the same 3D models) ----------
  const GUIDE = [
    { key: 'car', name: '자동차', desc: '같은 방향으로 달리는 느린 차예요. 차선을 바꿔 피하거나 날아서 넘어요.' },
    { key: 'tire', name: '굴러오는 바퀴', desc: '차보다 빠르게 굴러와요. 옆 차선으로 비스듬히 넘어오기도 해요.' },
    { key: 'granny', name: '길 건너는 할머니', desc: '횡단보도를 따라 천천히 건너요. 할머니가 있는 차선을 피하세요.' },
    { key: 'deer', name: '고라니', desc: '길가에서 뛰어나와 가운데 차선에 멈춰 서요. 내려앉은 뒤에 부딪히면 끝이에요.' },
    { key: 'fuel', name: '연료통', good: true, desc: `반짝이는 연료통을 먹으면 연료가 ${CFG.fuelRefill} 채워져요. 한 번 날 때 ${CFG.flyCost}를 써요.` },
    { key: 'rainbow', name: '무지개 연료통', good: true, desc: `가끔 나와요. 먹으면 ${CFG.rainbowSec}초 동안 하늘을 날아서 아무것에도 부딪히지 않아요.` },
  ];
  let guideBuilt = false;
  function buildGuide() {
    if (guideBuilt) return;
    guideBuilt = true;
    let thumbs = {};
    try {
      const tr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      tr.setPixelRatio(2);
      tr.setSize(192, 144);
      const ts = new THREE.Scene();
      addLights(ts);
      const cam = new THREE.PerspectiveCamera(35, 4 / 3, 0.1, 50);
      const shots = {
        car: [makeCar(TRAFFIC[0], false), [4.5, 3.2, 6.5], [0, 0.8, 0]],
        tire: [makeTire(), [2.4, 1.6, 2.8], [0, 0.6, 0]],
        granny: [makeGranny(), [2.6, 1.8, 3.6], [0, 0.95, 0]],
        deer: [makeDeer(), [1.6, 2.2, 4.4], [0.1, 1.0, 0]],
        fuel: [makeFuel(), [1.8, 1.8, 3.4], [0, 0.95, 0]],
        rainbow: [makeFuel(true), [2.0, 2.0, 3.8], [0, 1.05, 0]],
      };
      animateFuel(shots.rainbow[0].userData, 0.9);
      shots.granny[0].userData.walk.visible = false;
      shots.granny[0].userData.fig.rotation.y = 0.5;
      shots.tire[0].userData.spin.rotation.x = 0.4;
      animateFuel(shots.fuel[0].userData, 0.3);
      Object.entries(shots).forEach(([key, [model, pos, look]]) => {
        ts.add(model);
        cam.position.set(...pos);
        cam.lookAt(...look);
        tr.render(ts, cam);
        thumbs[key] = tr.domElement.toDataURL('image/png');
        ts.remove(model);
      });
      tr.dispose();
      if (tr.forceContextLoss) tr.forceContextLoss();
    } catch (e) {
      thumbs = {};
    }
    const list = $('guideList');
    GUIDE.forEach(g => {
      const li = document.createElement('li');
      if (g.good) li.className = 'good';
      li.innerHTML = `
        ${thumbs[g.key] ? `<img class="thumb" src="${thumbs[g.key]}" alt="${g.name} 그림">` : '<span class="thumb"></span>'}
        <div>
          <div class="g-name">${g.name}<span class="chip ${g.good ? 'good' : ''}">${g.good ? '먹기' : '피하기'}</span></div>
          <p class="g-desc">${g.desc}</p>
        </div>`;
      list.appendChild(li);
    });
  }

  function openGuide() {
    buildGuide();
    startScreen.hidden = true;
    guideScreen.hidden = false;
    guideScreen.scrollTop = 0;
    $('guideClose').focus({ preventScroll: true });
  }
  function closeGuide() {
    guideScreen.hidden = true;
    startScreen.hidden = false;
    $('guideBtn').focus({ preventScroll: true });
  }
  function openColors() {
    startScreen.hidden = true;
    colorScreen.hidden = false;
    const current = document.querySelector('.swatch[aria-checked="true"]');
    if (current) current.focus({ preventScroll: true });
  }
  function closeColors() {
    colorScreen.hidden = true;
    startScreen.hidden = false;
    $('colorBtn').focus({ preventScroll: true });
  }

  // ---------- input ----------
  const KEY_DIR = { ArrowLeft: -1, ArrowRight: 1 };
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input')) return;   // typing a nickname never steers or starts
    if (e.key === 'Escape' && !rankScreen.hidden) { closeRank(); return; }
    if (e.key in KEY_DIR) {
      e.preventDefault();
      (KEY_DIR[e.key] < 0 ? leftBtn : rightBtn).classList.add('down');
      if (!e.repeat) move(KEY_DIR[e.key]);
    } else if (e.key === ' ' && state === 'play') {
      e.preventDefault();
      flyBtn.classList.add('down');
      if (!e.repeat) fly();
    } else if (e.key === 'Escape' && !guideScreen.hidden) {
      closeGuide();
    } else if (e.key === 'Escape' && !colorScreen.hidden) {
      closeColors();
    } else if (e.key === 'Enter' || e.key === ' ') {
      // A focused button handles its own Enter/Space; held keys and the crash moment never restart
      if (e.target.closest && e.target.closest('button:not(.pad)')) return;
      e.preventDefault();
      if (e.repeat || !guideScreen.hidden || !colorScreen.hidden) return;
      if (state === 'ready' || (state === 'over' && !overScreen.hidden)) start();
    }
  });
  window.addEventListener('keyup', e => {
    if (e.key in KEY_DIR) (KEY_DIR[e.key] < 0 ? leftBtn : rightBtn).classList.remove('down');
    if (e.key === ' ') flyBtn.classList.remove('down');
  });

  [[leftBtn, () => move(-1)], [rightBtn, () => move(1)], [flyBtn, fly]].forEach(([btn, act]) => {
    btn.addEventListener('pointerdown', e => { e.preventDefault(); btn.classList.add('down'); act(); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, () => btn.classList.remove('down')));
    btn.addEventListener('contextmenu', e => e.preventDefault());
  });

  $('startBtn').addEventListener('click', start);
  $('retryBtn').addEventListener('click', start);
  $('homeBtn').addEventListener('click', goHome);
  $('guideBtn').addEventListener('click', openGuide);
  $('guideClose').addEventListener('click', closeGuide);
  $('colorBtn').addEventListener('click', openColors);
  soundBtn.addEventListener('click', toggleMusic);
  // every menu button (not the driving pedals, which have their own sounds) gives a soft click
  document.querySelectorAll('button:not(.pad)').forEach(b => b.addEventListener('click', playClick));
  $('colorDone').addEventListener('click', closeColors);
  $('rankBtn').addEventListener('click', () => openRank(startScreen));
  $('rankClose').addEventListener('click', closeRank);

  // ---------- leaderboard ----------
  // leaderboard.js does the storage: Firebase when configured (one shared live board),
  // otherwise this browser only. Each player appears once, with their best run.
  const LB = window.Leaderboard;
  const rankScreen = $('rankScreen'), rankList = $('rankList'), rankNote = $('rankNote');
  const overRank = $('overRank');
  const cleanNick = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 10);
  // the last nickname used is remembered so the Game Over field comes pre-filled
  let savedNick = '';
  try { savedNick = localStorage.getItem('supercar-nick') || ''; } catch (e) {}
  const rememberNick = n => { savedNick = n; try { localStorage.setItem('supercar-nick', n); } catch (e) {} };

  let board = [], boardState = 'loading';            // loading | ready | error
  let lastScore = 0, myBest = 0, saveState = '';     // '' | ask | saving | best | saved | slow | error
  // online rows are keyed by this browser's player id; local rows by nickname
  const isMine = r => (LB.mode === 'online' ? r.id === LB.me : r.id === savedNick);

  function renderBoard() {
    rankList.textContent = '';
    rankNote.textContent =
      boardState === 'loading' ? '순위를 불러오는 중이에요…'
      : boardState === 'error' && !board.length ? '순위를 불러오지 못했어요. 잠시 후 다시 열어 보세요.'
      : !board.length ? '아직 기록이 없어요. 첫 번째 주인공이 되어 보세요!'
      : LB.mode === 'online' ? '10초 = 100점 · 한 사람당 최고 기록 하나만 올라가요'
      : '이 기기에서 낸 기록이에요 · 10초 = 100점';
    board.slice(0, 20).forEach((r, i) => {
      const li = document.createElement('li');
      const mine = isMine(r);
      if (mine) li.className = 'me';
      const no = document.createElement('span');
      no.className = 'rank-no';
      no.textContent = String(i + 1);
      const nick = document.createElement('span');
      nick.className = 'rank-nick';
      nick.textContent = r.nick + (mine ? ' (나)' : '');   // other players' text: textContent only
      const sc = document.createElement('span');
      sc.className = 'rank-score';
      sc.textContent = `${r.score}점`;
      li.append(no, nick, sc);
      rankList.appendChild(li);
    });
  }

  function renderOverRank() {
    if (state !== 'over') return;
    // live board updates re-render this panel; never rebuild the nickname field while someone types
    if (saveState === 'ask' && overRank.querySelector('input')) return;
    overRank.textContent = '';
    const msg = document.createElement('p');
    msg.className = 'rank-msg';
    const idx = board.findIndex(isMine);
    const where = idx >= 0 ? ` · 지금 ${idx + 1}위` : '';
    if (saveState === 'ask') {
      msg.textContent = '닉네임을 쓰고 순위에 올려 보세요';
      const row = document.createElement('div');
      row.className = 'row';
      const input = document.createElement('input');
      input.className = 'nick';
      input.maxLength = 10;
      input.placeholder = '닉네임';
      input.value = savedNick;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('aria-label', '닉네임');
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'small-btn';
      ok.textContent = '순위 등록';
      const register = () => {
        const n = cleanNick(input.value);
        if (!n) { input.focus(); return; }
        rememberNick(n);
        submitScore(lastScore, n);
      };
      ok.addEventListener('click', register);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') register(); });
      row.append(input, ok);
      overRank.append(msg, row);
      return;
    }
    msg.textContent =
      saveState === 'saving' ? '순위에 올리는 중…'
      : saveState === 'best' ? `새 최고 기록!${where}`
      : saveState === 'saved' ? `내 최고 기록 ${myBest}점${where}`
      : saveState === 'slow' ? '기록을 보냈어요. 순위 반영이 늦으면 순위 보기를 눌러 확인해 보세요'
      : saveState === 'error' ? '순위에 올리지 못했어요. 인터넷 연결을 확인해 주세요' : '';
    overRank.appendChild(msg);
    const see = document.createElement('button');
    see.type = 'button';
    see.className = 'rank-btn';
    // trophy icon + label (static markup, no player text)
    see.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6M10 17h4" /></svg>순위 보기';
    see.addEventListener('click', () => openRank(overScreen));
    overRank.appendChild(see);
  }

  async function submitScore(score, nick) {
    saveState = 'saving';
    renderOverRank();
    try {
      const res = await LB.submit(nick, score);
      myBest = res.myBest;
      saveState = res.best ? 'best' : 'saved';
    } catch (e) {
      // a timeout usually means the record went through but the reply got lost on the way back
      saveState = e && e.code === 'timeout' ? 'slow' : 'error';
      if (saveState === 'slow') setTimeout(() => LB.refresh(), 3000);
    }
    renderOverRank();
  }

  let rankReturn = startScreen;
  function openRank(from) {
    rankReturn = from;
    from.hidden = true;
    rankScreen.hidden = false;
    rankScreen.scrollTop = 0;
    renderBoard();
    LB.refresh();   // pull the latest from the server in case live updates stalled
    $('rankClose').focus({ preventScroll: true });
  }
  function closeRank() {
    rankScreen.hidden = true;
    rankReturn.hidden = false;
  }

  LB.start((rows, st) => {
    board = rows;
    boardState = st;
    renderBoard();
    renderOverRank();
  });
  new ResizeObserver(resize).observe(stage);
  resize();
  setWeather(MORNING, WEATHERS[0], 'mountain');   // the main screen is always a clear morning in the mountains
  showcase();
  updateHud();
  let lastTs = performance.now();
  requestAnimationFrame(frame);
})();
