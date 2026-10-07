// Anime look: cel shading, a soft rim light, and ink outlines.
//  - Cel shading: every lit material bands its sunlight into a shadow tone, a lit tone and
//    a bright highlight, instead of a smooth gradient.
//  - Rim light: walls and characters catch a thin glow on their edges; floors do not.
//  - Ink outlines: a post-process traces silhouettes and creases from the depth buffer.
//    It uses the Laplacian of 1/depth, which is zero on any flat surface, so the ground
//    stays clean while edges get crisp lines.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Patch Three's shader chunks once, before anything compiles.
let patched = false;
export function applyToonShading() {
  if (patched) return;
  patched = true;
  const C = THREE.ShaderChunk;
  C.common += `
float toonBand(float x) {
  float lit = smoothstep(0.0, 0.07, x);
  float hi = smoothstep(0.5, 0.56, x);
  return lit * 0.66 + hi * 0.34;
}`;
  const from = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
  for (const k of Object.keys(C)) {
    if (typeof C[k] === 'string' && C[k].includes(from)) C[k] = C[k].split(from).join('float dotNL = toonBand( dot( geometryNormal, directLight.direction ) );');
  }
  C.lights_fragment_end += `
{
  // Rim light on surfaces that face sideways (characters, walls), never on the ground.
  vec3 upView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float side = 1.0 - abs(dot(geometryNormal, upView));
  float rim = smoothstep(0.62, 0.9, 1.0 - saturate(dot(geometryNormal, geometryViewDir))) * side;
  reflectedLight.indirectDiffuse += diffuseColor.rgb * rim * 0.55;
}`;
}

const inkShader = {
  uniforms: {
    tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() },
    uNear: { value: 0.1 }, uFar: { value: 3000 }, uThick: { value: 1 }, uStrength: { value: 0.85 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D tColor, tDepth; uniform vec2 uTexel; uniform float uNear, uFar, uThick, uStrength; varying vec2 vUv;
    float invZ(vec2 uv) {
      float ndc = texture2D(tDepth, uv).x * 2.0 - 1.0;
      float z = 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear));
      return 1.0 / z;
    }
    void main() {
      vec4 c = texture2D(tColor, vUv);
      vec2 o = uTexel * uThick;
      float cz = invZ(vUv);
      float lap = invZ(vUv + vec2(o.x, 0.0)) + invZ(vUv - vec2(o.x, 0.0)) + invZ(vUv + vec2(0.0, o.y)) + invZ(vUv - vec2(0.0, o.y)) - 4.0 * cz;
      float edge = smoothstep(0.1, 0.32, abs(lap) / max(cz, 1e-6));
      // Lines fade out with distance so far hills stay soft.
      float fade = 1.0 - smoothstep(70.0, 200.0, 1.0 / cz);
      // Ink is a deep version of the surface color, like an anime line.
      vec3 ink = c.rgb * vec3(0.1, 0.09, 0.12);
      gl_FragColor = vec4(mix(c.rgb, ink, edge * fade * uStrength), c.a);
    }`,
};

// Renders the scene with depth, then writes it on with ink outlines. Use it in place of
// RenderPass as the first pass of the composer.
export class InkScenePass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) });
    this.material = new THREE.ShaderMaterial({ ...inkShader, uniforms: THREE.UniformsUtils.clone(inkShader.uniforms), depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.material);
  }
  setSize(w, h) {
    this.rt.setSize(w, h);
    this.material.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.material.uniforms.uThick.value = Math.max(1, h / 800);
  }
  render(renderer, writeBuffer) {
    const u = this.material.uniforms;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    u.tColor.value = this.rt.texture;
    u.tDepth.value = this.rt.depthTexture;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.rt.dispose(); this.material.dispose(); this.quad.dispose(); }
}
