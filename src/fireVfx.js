// Fire and smoke for skills and the world.
//  - Flames are ray-marched volumes. A noise field scrolls upward (buoyancy) and its
//    turbulence grows with height; temperature runs from a white-hot core to deep red tips.
//  - Walls of fire are rings of separate clumps, each a few tongues; a fire whirl winds
//    its flame into helical sheets.
//  - Smoke is charcoal, drawn after the scene, and lit only by nearby fire (never the sun).
//  - Embers rise hot and cool to ash, then drift down.
//  - Heat haze shimmers over hot spots; grass near them chars and its tips smoulder.
//  - Impact frames are gentle and limited to three flashes a second.
import * as THREE from 'three';

let scene = null, camera = null, height = null, gfxHigh = true;
const uTime = { value: 0 };
export function initFire(sc, cam, heightFn) { scene = sc; camera = cam; height = heightFn; }
export function setFireQuality(high) { gfxHigh = high; for (const f of flames) f.mat.uniforms.uSteps.value = high ? 26 : 12; }

// ============================================================ Flame volumes
const NOISE = `
float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise3(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * vnoise3(p); p = p * 2.03 + vec3(1.7, -3.1, 0.9); a *= 0.5; } return s; }
`;
const flameVert = `
varying vec3 vLocal; varying vec3 vCam;
void main(){
  vLocal = position;
  vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const flameFrag = `
uniform float uTime, uIntensity, uSeed, uMode, uTongues, uRise; uniform int uSteps;
varying vec3 vLocal; varying vec3 vCam;
${NOISE}
// Temperature ramp: deep red tips, orange, yellow, a white-hot core.
vec3 ramp(float T){
  vec3 c = mix(vec3(0.5, 0.04, 0.01), vec3(1.0, 0.32, 0.03), smoothstep(0.04, 0.3, T));
  c = mix(c, vec3(1.0, 0.72, 0.22), smoothstep(0.3, 0.6, T));
  return mix(c, vec3(1.0, 0.96, 0.86), smoothstep(0.62, 0.92, T));
}
float density(vec3 p, out float temp){
  float h = p.y;
  // Buoyancy: the noise field rises through the flame; turbulence grows with height.
  vec3 q = vec3(p.x * 3.0, h * 2.2 - uTime * uRise, p.z * 3.0) + uSeed;
  vec2 off = vec2(fbm3(q), fbm3(q + vec3(5.2, 1.3, 2.8))) - 0.5;
  vec2 xz = p.xz + off * (0.12 + h * 0.85) * 0.55;
  float d;
  if (uMode < 0.5) {
    float r = 0.42 * pow(max(1.0 - h, 0.0), 0.75) + 0.02;
    // Separate tongues near the top.
    float ang = atan(xz.y, xz.x);
    float tongue = 0.5 + 0.5 * sin(ang * uTongues + fbm3(q * 1.3) * 6.0 + uSeed);
    r *= mix(1.0, 0.4 + 0.8 * tongue, smoothstep(0.15, 0.7, h));
    d = 1.0 - length(xz) / r + (fbm3(q * 2.0) - 0.5) * 0.5;
    temp = clamp(d * 1.5 * (1.0 - h * 0.9), 0.0, 1.0);
  } else {
    // Fire whirl: flame wound into helical sheets around a rising column.
    float ang = atan(xz.y, xz.x), rad = length(xz), ring = 0.16 + h * 0.24;
    float sheet = sin(ang * 2.0 + h * 14.0 - uTime * 9.0 + fbm3(q) * 2.0);
    d = smoothstep(0.5, 1.0, sheet) * (1.0 - abs(rad - ring) / 0.13) + (fbm3(q * 2.0) - 0.5) * 0.35;
    temp = clamp(d * (1.25 - h), 0.0, 1.0);
  }
  d *= smoothstep(0.0, 0.06, h) * smoothstep(1.0, 0.72, h);
  return clamp(d, 0.0, 1.0);
}
void main(){
  vec3 ro = vCam, rd = normalize(vLocal - vCam);
  vec3 t0 = (vec3(-0.5, 0.0, -0.5) - ro) / rd, t1 = (vec3(0.5, 1.0, 0.5) - ro) / rd;
  vec3 tmn = min(t0, t1), tmx = max(t0, t1);
  float tn = max(max(tmn.x, tmn.y), max(tmn.z, 0.0)), tf = min(min(tmx.x, tmx.y), tmx.z);
  if (tf <= tn) discard;
  float stepL = (tf - tn) / float(uSteps);
  vec3 col = vec3(0.0); float tr = 1.0;
  for (int i = 0; i < 40; i++) {
    if (i >= uSteps) break;
    vec3 p = ro + rd * (tn + (float(i) + 0.5) * stepL);
    float temp; float d = density(p, temp);
    if (d > 0.001) { float a = d * stepL * 6.0; col += ramp(temp) * a * tr * (0.6 + temp * 2.6); tr *= exp(-a * 0.5); }
  }
  gl_FragColor = vec4(col * uIntensity, 1.0);
}`;
const flameGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const flames = [];
function makeFlame({ x, y, z, w = 1, h = 2, mode = 0, tongues = 4, rise = 2.2, intensity = 1 }) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime, uIntensity: { value: intensity }, uSeed: { value: Math.random() * 50 }, uMode: { value: mode },
      uTongues: { value: tongues }, uRise: { value: rise }, uSteps: { value: gfxHigh ? 26 : 12 },
    },
    vertexShader: flameVert, fragmentShader: flameFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(flameGeo, mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, w);
  mesh.renderOrder = 5;
  mesh.frustumCulled = true;
  scene.add(mesh);
  const f = { mesh, mat, base: intensity, life: Infinity, age: 0, fadeIn: 0.15, fadeOut: 0.6, spin: 0, follow: null, heat: w * h };
  flames.push(f);
  return f;
}
function removeFlame(f) {
  scene.remove(f.mesh);
  f.mat.dispose();
  const i = flames.indexOf(f);
  if (i >= 0) flames.splice(i, 1);
}

// ============================================================ Smoke
const SMAX = 700;
const sPos = new Float32Array(SMAX * 3), sSize = new Float32Array(SMAX), sAlpha = new Float32Array(SMAX), sLight = new Float32Array(SMAX * 3);
const sVel = new Float32Array(SMAX * 3), sLife = new Float32Array(SMAX), sMax = new Float32Array(SMAX), sGrow = new Float32Array(SMAX), sDark = new Float32Array(SMAX);
let sNext = 0;
const smokeGeo = new THREE.BufferGeometry();
smokeGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
smokeGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1).setUsage(THREE.DynamicDrawUsage));
smokeGeo.setAttribute('aAlpha', new THREE.BufferAttribute(sAlpha, 1).setUsage(THREE.DynamicDrawUsage));
smokeGeo.setAttribute('aLight', new THREE.BufferAttribute(sLight, 3).setUsage(THREE.DynamicDrawUsage));
const smokeMat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 400 }, uTime },
  vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aLight;
    uniform float uScale; varying float vAlpha; varying vec3 vLight; varying float vSeed;
    void main(){ vAlpha = aAlpha; vLight = aLight; vSeed = position.x * 3.1 + position.z * 1.7;
      vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
      gl_PointSize = aSize * uScale / max(0.1, -mv.z); }`,
  fragmentShader: `uniform float uTime; varying float vAlpha; varying vec3 vLight; varying float vSeed;
    ${NOISE}
    void main(){
      vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0;
      if (r > 1.0) discard;
      // Billowing edges: noise eats into the puff.
      float n = fbm3(vec3(gl_PointCoord * 3.0, vSeed + uTime * 0.3));
      float a = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.6) * vAlpha;
      // Charcoal, lit only by the fire nearby.
      vec3 col = vec3(0.055, 0.05, 0.048) * (0.7 + n * 0.6) + vLight * (1.0 - r * 0.5);
      gl_FragColor = vec4(col, a);
    }`,
  transparent: true, depthWrite: false,
});
const smokePts = new THREE.Points(smokeGeo, smokeMat);
smokePts.frustumCulled = false;
smokePts.renderOrder = 20;
export function smoke(x, y, z, n = 6, { size = 1, rise = 1.6, spread = 0.6, life = 3.2, alpha = 0.55 } = {}) {
  for (let k = 0; k < n; k++) {
    const i = sNext; sNext = (sNext + 1) % SMAX;
    sPos[i * 3] = x + (Math.random() - 0.5) * spread; sPos[i * 3 + 1] = y + Math.random() * 0.3; sPos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
    sVel[i * 3] = (Math.random() - 0.5) * 0.5; sVel[i * 3 + 1] = rise * (0.7 + Math.random() * 0.6); sVel[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    sMax[i] = sLife[i] = life * (0.7 + Math.random() * 0.6);
    sSize[i] = size * (0.5 + Math.random() * 0.4);
    sGrow[i] = size * (0.9 + Math.random() * 0.6);
    sDark[i] = alpha;
  }
}

// ============================================================ Embers that cool to ash
const EMAX = 600;
const ePos = new Float32Array(EMAX * 3), eCol = new Float32Array(EMAX * 3), eSize = new Float32Array(EMAX);
const eVel = new Float32Array(EMAX * 3), eHeat = new Float32Array(EMAX), eLife = new Float32Array(EMAX), eSeed = new Float32Array(EMAX);
let eNext = 0;
const emberGeo = new THREE.BufferGeometry();
emberGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3).setUsage(THREE.DynamicDrawUsage));
emberGeo.setAttribute('color', new THREE.BufferAttribute(eCol, 3).setUsage(THREE.DynamicDrawUsage));
emberGeo.setAttribute('aSize', new THREE.BufferAttribute(eSize, 1).setUsage(THREE.DynamicDrawUsage));
const emberMat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 400 } },
  vertexShader: `attribute float aSize; uniform float uScale; varying vec3 vCol;
    void main(){ vCol = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
      gl_PointSize = max(1.5, aSize * uScale / max(0.1, -mv.z)); }`,
  fragmentShader: `varying vec3 vCol;
    void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard; gl_FragColor = vec4(vCol, smoothstep(1.0, 0.4, r)); }`,
  vertexColors: true, transparent: true, depthWrite: false,
});
const emberPts = new THREE.Points(emberGeo, emberMat);
emberPts.frustumCulled = false;
emberPts.renderOrder = 21;
export function embers(x, y, z, n = 10, { speed = 3, spread = 0.5, heat = 1 } = {}) {
  for (let k = 0; k < n; k++) {
    const i = eNext; eNext = (eNext + 1) % EMAX;
    ePos[i * 3] = x + (Math.random() - 0.5) * spread; ePos[i * 3 + 1] = y + Math.random() * 0.4; ePos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
    const a = Math.random() * Math.PI * 2, s = speed * (0.2 + Math.random() * 0.5);
    eVel[i * 3] = Math.cos(a) * s * 0.5; eVel[i * 3 + 1] = speed * (0.6 + Math.random() * 0.8); eVel[i * 3 + 2] = Math.sin(a) * s * 0.5;
    eHeat[i] = heat * (0.75 + Math.random() * 0.25);
    eLife[i] = 3 + Math.random() * 2.5;
    eSize[i] = 0.05 + Math.random() * 0.05;
    eSeed[i] = Math.random() * 100;
  }
}
// Ember color by heat: white-yellow, orange, red, then grey ash.
function emberColor(h, out, i) {
  let r, g, b;
  if (h > 0.6) { const k = (h - 0.6) / 0.4; r = 4; g = 1.6 + 1.6 * k; b = 0.3 + 0.9 * k; }
  else if (h > 0.25) { const k = (h - 0.25) / 0.35; r = 1.4 + 2.6 * k; g = 0.25 + 1.35 * k; b = 0.05 + 0.25 * k; }
  else if (h > 0.08) { const k = (h - 0.08) / 0.17; r = 0.3 + 1.1 * k; g = 0.27 - 0.02 * k; b = 0.26 - 0.21 * k; }
  else { r = 0.3; g = 0.29; b = 0.28; }
  out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b;
}

// ============================================================ Heat: haze and smouldering ground
// Transient hot spots (skills, burning foes) plus nearby persistent fires feed both the
// screen-space heat haze and the grass shader.
const transientHeat = [];
export function addHeat(x, y, z, r, heat, life) { transientHeat.push({ x, y, z, r, heat, life, max: life }); }
export const hazeUniforms = { uHaze: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }, uCount: { value: 0 }, uTime, uAspect: { value: 1 } };
export const hazeShader = {
  uniforms: { tDiffuse: { value: null }, ...hazeUniforms },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec4 uHaze[8]; uniform int uCount; uniform float uTime, uAspect; varying vec2 vUv;
    void main(){
      vec2 off = vec2(0.0);
      for (int i = 0; i < 8; i++) {
        if (i >= uCount) break;
        vec4 h = uHaze[i];
        vec2 d = vUv - h.xy; d.x *= uAspect;
        float f = smoothstep(h.z, 0.0, length(d));
        // Shimmer that rolls upward.
        off += vec2(sin(vUv.y * 90.0 - uTime * 7.0 + vUv.x * 20.0), cos(vUv.x * 70.0 - uTime * 5.0)) * f * h.w;
      }
      gl_FragColor = texture2D(tDiffuse, vUv + off * 0.0035);
    }`,
};
// Grass reads these: xyz = position, w = radius; uHeatK = heat 0..1 per spot.
export const groundHeat = { uHot: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -999, 0, 0)) }, uHotK: { value: new Float32Array(8) }, uTime };

// ============================================================ Persistent fire sites in the world
let sites = [];
export function setFireSites(list) { sites = list; }
const siteFlames = new Map();
let siteTimer = 0;

// ============================================================ Skill effects
// A wall of fire: a ring of separate clumps, each a few tongues of different heights.
export function fireWall(x, z, radius, { clumps = 10, life = 1.8, power = 1 } = {}) {
  for (let c = 0; c < clumps; c++) {
    const a = (c / clumps) * Math.PI * 2 + Math.random() * 0.2;
    const cx = x + Math.cos(a) * radius, cz = z + Math.sin(a) * radius, gy = height(cx, cz);
    const tongues = 2 + Math.floor(Math.random() * 2);
    for (let t = 0; t < tongues; t++) {
      const o = (t - (tongues - 1) / 2) * 0.55;
      const fx = cx - Math.sin(a) * o + (Math.random() - 0.5) * 0.3, fz = cz + Math.cos(a) * o + (Math.random() - 0.5) * 0.3;
      const f = makeFlame({ x: fx, y: gy - 0.1, z: fz, w: 0.8 + Math.random() * 0.5, h: (1.6 + Math.random() * 1.6) * power, tongues: 3 + Math.floor(Math.random() * 3), intensity: 1.1 });
      f.life = life * (0.85 + Math.random() * 0.3);
      f.fadeIn = 0.12 + c * 0.012;
    }
    smoke(cx, gy + 1.8, cz, 3, { size: 1.6, life: 3.5 });
    embers(cx, gy + 0.4, cz, 6, { speed: 3.2 });
  }
  addHeat(x, height(x, z), z, radius + 1.5, 1, life + 4);
}
// A fire whirl: a tall column of flame wound into helical sheets, with a hot core.
export function fireWhirl(x, z, { life = 1.4, h = 7, w = 3 } = {}) {
  const gy = height(x, z);
  const sheet = makeFlame({ x, y: gy - 0.1, z, w, h, mode: 1, rise: 4, intensity: 1.2 });
  sheet.life = life; sheet.spin = 4;
  const core = makeFlame({ x, y: gy - 0.1, z, w: w * 0.45, h: h * 0.6, tongues: 5, rise: 3.5, intensity: 1 });
  core.life = life * 0.9;
  smoke(x, gy + h * 0.9, z, 8, { size: 2.6, life: 4, spread: 1.5, rise: 2.4 });
  embers(x, gy + 1, z, 30, { speed: 6, spread: 1.2 });
  addHeat(x, gy, z, w * 1.4, 1, life + 3);
}
// A small flame that follows something (a burning enemy). Returns a handle with stop().
export function attachFlame(getPos, { w = 0.7, h = 1.4 } = {}) {
  const p = getPos();
  const f = makeFlame({ x: p.x, y: p.y, z: p.z, w, h, tongues: 3, intensity: 0.9 });
  f.follow = getPos;
  return { stop() { f.life = Math.min(f.life, f.age + 0.4); f.fadeOut = 0.4; }, flame: f };
}
// Smoke and embers from a heavy impact on the ground (slams, stomps).
export function impactSmoke(x, z, radius, demon) {
  const gy = height(x, z);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    smoke(x + Math.cos(a) * radius * 0.6, gy + 0.3, z + Math.sin(a) * radius * 0.6, 1, { size: 1.4, rise: 0.8, life: 2.5, alpha: 0.45 });
  }
  if (demon) { embers(x, gy + 0.3, z, 18, { speed: 4, spread: radius * 0.6 }); addHeat(x, gy, z, radius * 0.6, 0.6, 2.5); }
}

// ---- Impact frames: gentle, and never more than three flashes in any second.
const flashTimes = [];
export function flashAllowed(now) {
  while (flashTimes.length && now - flashTimes[0] > 1000) flashTimes.shift();
  if (flashTimes.length >= 3) return false;
  flashTimes.push(now);
  return true;
}

// ============================================================ Per-frame update
const _v = new THREE.Vector3();
let added = false;
export function updateFire(dt, camPos) {
  if (!added) { scene.add(smokePts, emberPts); added = true; }
  uTime.value += dt;
  const scale = window.innerHeight / (2 * Math.tan((camera.fov * Math.PI / 180) / 2));
  smokeMat.uniforms.uScale.value = scale;
  emberMat.uniforms.uScale.value = scale;
  hazeUniforms.uAspect.value = camera.aspect;

  // Persistent sites: flames only for the nearest few, smoke and embers from nearby ones.
  siteTimer -= dt;
  if (siteTimer <= 0) {
    siteTimer = 0.5;
    const near = sites.map(s => [s, Math.hypot(s.x - camPos.x, s.z - camPos.z)]).filter(([, d]) => d < 95).sort((a, b) => a[1] - b[1]).slice(0, 12).map(([s]) => s);
    for (const [s, f] of siteFlames) if (!near.includes(s)) { removeFlame(f); siteFlames.delete(s); }
    for (const s of near) if (s.flame && !siteFlames.has(s)) {
      const f = makeFlame({ x: s.x, y: s.y, z: s.z, w: s.w, h: s.h, tongues: 4, intensity: 1 });
      siteFlames.set(s, f);
    }
  }
  for (const s of sites) {
    const d = Math.hypot(s.x - camPos.x, s.z - camPos.z);
    if (d > 70) continue;
    const rate = s.smoke ?? 1.5;
    if (Math.random() < rate * dt) smoke(s.x, s.y + (s.h ?? 1) * 0.9, s.z, 1, { size: s.smokeSize ?? 1.2, life: s.smokeLife ?? 4, rise: 1.4 });
    if (s.flame && Math.random() < 2 * dt) embers(s.x, s.y + s.h * 0.5, s.z, 1, { speed: 2.2, spread: s.w * 0.6 });
  }

  // Flames: lifetimes, fades, spin, following.
  for (let i = flames.length - 1; i >= 0; i--) {
    const f = flames[i];
    f.age += dt;
    let k = Math.min(1, f.age / f.fadeIn);
    if (f.life !== Infinity) k *= Math.min(1, Math.max(0, (f.life - f.age) / f.fadeOut));
    f.mat.uniforms.uIntensity.value = f.base * k * (0.92 + 0.08 * Math.sin(uTime.value * 13 + i));
    if (f.spin) f.mesh.rotation.y += f.spin * dt;
    if (f.follow) { const p = f.follow(); f.mesh.position.set(p.x, p.y, p.z); }
    if (f.age >= f.life) removeFlame(f);
  }

  // Smoke: rises, slows, spreads; lit by fire within a few meters.
  const lights = flames.slice(0, 24);
  for (let i = 0; i < SMAX; i++) {
    if (sLife[i] <= 0) { sAlpha[i] = 0; continue; }
    sLife[i] -= dt;
    const t = 1 - sLife[i] / sMax[i];
    sVel[i * 3 + 1] *= Math.exp(-0.35 * dt);
    sPos[i * 3] += (sVel[i * 3] + Math.sin(uTime.value * 0.4 + i) * 0.3) * dt;
    sPos[i * 3 + 1] += sVel[i * 3 + 1] * dt;
    sPos[i * 3 + 2] += sVel[i * 3 + 2] * dt;
    sSize[i] += sGrow[i] * dt * 0.8;
    sAlpha[i] = sDark[i] * Math.min(1, t * 6) * (1 - t);
    let lr = 0, lg = 0, lb = 0;
    for (const f of lights) {
      const p = f.mesh.position, dx = sPos[i * 3] - p.x, dy = sPos[i * 3 + 1] - (p.y + f.mesh.scale.y * 0.4), dz = sPos[i * 3 + 2] - p.z;
      const l = f.mat.uniforms.uIntensity.value * f.mesh.scale.y * 0.35 / (1 + dx * dx + dy * dy + dz * dz);
      lr += l; lg += l * 0.38; lb += l * 0.08;
    }
    sLight[i * 3] = Math.min(lr, 1.2); sLight[i * 3 + 1] = Math.min(lg, 0.5); sLight[i * 3 + 2] = Math.min(lb, 0.12);
  }
  smokeGeo.attributes.position.needsUpdate = true;
  smokeGeo.attributes.aSize.needsUpdate = true;
  smokeGeo.attributes.aAlpha.needsUpdate = true;
  smokeGeo.attributes.aLight.needsUpdate = true;

  // Embers: rise on turbulent air while hot, cool, then drift down as ash.
  for (let i = 0; i < EMAX; i++) {
    if (eLife[i] <= 0) { eSize[i] = 0; continue; }
    eLife[i] -= dt;
    eHeat[i] = Math.max(0, eHeat[i] - dt * 0.42);
    const buoy = eHeat[i] > 0.15 ? 1 : -0.35;
    eVel[i * 3 + 1] += (buoy * 1.2 - eVel[i * 3 + 1] * 0.8) * dt;
    const s = eSeed[i], tt = uTime.value;
    eVel[i * 3] += Math.sin(tt * 2.1 + s) * 2.2 * dt;
    eVel[i * 3 + 2] += Math.cos(tt * 1.7 + s * 1.3) * 2.2 * dt;
    ePos[i * 3] += eVel[i * 3] * dt; ePos[i * 3 + 1] += eVel[i * 3 + 1] * dt; ePos[i * 3 + 2] += eVel[i * 3 + 2] * dt;
    emberColor(eHeat[i], eCol, i);
    if (eLife[i] < 0.6) eSize[i] *= 0.96;
  }
  emberGeo.attributes.position.needsUpdate = true;
  emberGeo.attributes.color.needsUpdate = true;
  emberGeo.attributes.aSize.needsUpdate = true;

  // Heat sources: transient spots, burning flames and nearby sites.
  for (let i = transientHeat.length - 1; i >= 0; i--) { transientHeat[i].life -= dt; if (transientHeat[i].life <= 0) transientHeat.splice(i, 1); }
  const heat = [];
  for (const h of transientHeat) heat.push({ x: h.x, y: h.y, z: h.z, r: h.r, k: h.heat * Math.min(1, h.life / 2), haze: h.life > h.max - 2.5 ? 1 : 0.4 });
  for (const f of flames) if (f.follow || f.life === Infinity) {
    const p = f.mesh.position;
    heat.push({ x: p.x, y: p.y, z: p.z, r: f.mesh.scale.x * 1.6, k: f.life === Infinity ? 0.5 : 0.7, haze: 0.7 });
  }
  heat.sort((a, b) => Math.hypot(a.x - camPos.x, a.z - camPos.z) - Math.hypot(b.x - camPos.x, b.z - camPos.z));
  // Grass.
  for (let i = 0; i < 8; i++) {
    const h = heat[i];
    if (h) { groundHeat.uHot.value[i].set(h.x, h.y, h.z, h.r); groundHeat.uHotK.value[i] = h.k; }
    else { groundHeat.uHot.value[i].set(0, -999, 0, 0); groundHeat.uHotK.value[i] = 0; }
  }
  // Haze: project each hot spot (a little above it) to the screen.
  let n = 0;
  for (const h of heat) {
    if (n >= 8) break;
    _v.set(h.x, h.y + 1.6, h.z).project(camera);
    if (_v.z > 1 || Math.abs(_v.x) > 1.3 || Math.abs(_v.y) > 1.3) continue;
    const dist = Math.max(2, Math.hypot(h.x - camPos.x, h.z - camPos.z));
    hazeUniforms.uHaze.value[n].set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5, Math.min(0.45, h.r * 1.4 / dist), h.haze * (gfxHigh ? 1 : 0));
    n++;
  }
  hazeUniforms.uCount.value = n;
}
