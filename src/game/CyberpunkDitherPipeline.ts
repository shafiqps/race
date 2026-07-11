import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

interface DitherUniforms {
  tDiffuse: { value: THREE.Texture | null };
  uResolution: { value: THREE.Vector2 };
  uAmount: { value: number };
  uLevels: { value: number };
  uCellSize: { value: number };
  uFeedback: { value: number };
  uError: { value: number };
  uTime: { value: number };
}

const DITHER_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAmount: { value: 0.32 },
    uLevels: { value: 9 },
    uCellSize: { value: 1 },
    uFeedback: { value: 0 },
    uError: { value: 0 },
    uTime: { value: 0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uAmount;
    uniform float uLevels;
    uniform float uCellSize;
    uniform float uFeedback;
    uniform float uError;
    uniform float uTime;
    varying vec2 vUv;

    float bayer2(vec2 p) {
      return 2.0 * mod(p.x + p.y, 2.0) + mod(p.y, 2.0);
    }

    float bayer4(vec2 p) {
      vec2 pixel = floor(p);
      float coarse = bayer2(mod(pixel, 2.0));
      float fine = bayer2(mod(floor(pixel * 0.5), 2.0));
      return (4.0 * coarse + fine + 0.5) / 16.0;
    }

    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      float feedbackCell = uCellSize + uError * uFeedback * 1.65;
      vec2 grid = gl_FragCoord.xy / max(1.0, feedbackCell);
      float threshold = bayer4(grid);
      float scan = sin((gl_FragCoord.y + uTime * 22.0) * 0.52) * 0.015;

      float levels = max(3.0, uLevels - uError * uFeedback * 3.0);
      vec3 quantized = floor(source.rgb * levels + threshold) / levels;
      float neon = smoothstep(0.64, 1.0, max(source.r, max(source.g, source.b)));
      float localAmount = clamp(uAmount + uFeedback * (0.16 + uError * 0.28), 0.0, 0.86);
      localAmount *= 1.0 - neon * 0.46;

      vec3 color = mix(source.rgb, quantized, localAmount);
      color += scan * localAmount * (1.0 - neon);
      vec3 errorTint = vec3(color.r * 1.16, color.g * 0.74, color.b * 0.68);
      color = mix(color, errorTint, uError * uFeedback * 0.2);
      gl_FragColor = vec4(color, source.a);
    }
  `
};

/** Shared ordered-dither treatment with short gameplay-reactive pulses. */
export class CyberpunkDitherPipeline {
  private readonly composer: EffectComposer;
  private readonly pass: ShaderPass;
  private readonly uniforms: DitherUniforms;
  private feedback = 0;
  private error = 0;
  private motion = 0;
  private elapsed = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    private readonly reducedMotion = false
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(scene, camera));
    this.pass = new ShaderPass(DITHER_SHADER);
    this.uniforms = this.pass.uniforms as unknown as DitherUniforms;
    this.composer.addPass(this.pass);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    const ratio = this.renderer.getPixelRatio();
    this.uniforms.uResolution.value.set(width * ratio, height * ratio);
  }

  setMotion(amount: number): void {
    this.motion = THREE.MathUtils.clamp(amount, 0, 1);
  }

  pulse(correct: boolean): void {
    this.feedback = Math.max(this.feedback, correct ? 0.32 : 1);
    this.error = correct ? 0 : 1;
  }

  render(delta = 1 / 60): void {
    this.elapsed += delta;
    this.feedback = Math.max(0, this.feedback - delta * (this.error > 0 ? 2.8 : 4.6));
    this.uniforms.uFeedback.value = this.reducedMotion ? 0 : this.feedback;
    this.uniforms.uError.value = this.error;
    this.uniforms.uTime.value = this.elapsed;
    this.uniforms.uAmount.value = 0.31 - this.motion * 0.075;
    this.uniforms.uLevels.value = 9 + this.motion * 4;
    this.uniforms.uCellSize.value = 1 + (1 - this.motion) * 0.35;
    this.composer.render(delta);
  }

  dispose(): void {
    this.pass.dispose();
    this.composer.dispose();
  }
}
