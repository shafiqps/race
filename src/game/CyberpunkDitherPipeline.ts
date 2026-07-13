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
  uFeedback: { value: number };
  uError: { value: number };
  uMotion: { value: number };
  uTime: { value: number };
}

const MAX_INTERNAL_WIDTH = 640;
const MAX_INTERNAL_HEIGHT = 448;

const PS2_SIGNAL_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAmount: { value: 0.28 },
    uLevels: { value: 24 },
    uFeedback: { value: 0 },
    uError: { value: 0 },
    uMotion: { value: 0 },
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
    uniform float uFeedback;
    uniform float uError;
    uniform float uMotion;
    uniform float uTime;
    varying vec2 vUv;

    float bayer2(vec2 pixel) {
      return 2.0 * mod(pixel.x + pixel.y, 2.0) + mod(pixel.y, 2.0);
    }

    float bayer4(vec2 pixel) {
      float coarse = bayer2(mod(pixel, 2.0));
      float fine = bayer2(mod(floor(pixel * 0.5), 2.0));
      return (4.0 * coarse + fine + 0.5) / 16.0;
    }

    vec3 sampleSignal(vec2 uv, vec2 texel) {
      vec3 center = texture2D(tDiffuse, uv).rgb;
      vec3 horizontal = texture2D(tDiffuse, uv - vec2(texel.x, 0.0)).rgb
        + texture2D(tDiffuse, uv + vec2(texel.x, 0.0)).rgb;
      vec3 vertical = texture2D(tDiffuse, uv - vec2(0.0, texel.y)).rgb
        + texture2D(tDiffuse, uv + vec2(0.0, texel.y)).rgb;
      return center * 0.72 + horizontal * 0.09 + vertical * 0.05;
    }

    void main() {
      vec2 texel = 1.0 / max(uResolution, vec2(1.0));
      vec2 pixel = floor(vUv * uResolution);

      // A low-frequency half-pixel field shift gives moving geometry the unstable
      // sub-pixel silhouette associated with low-resolution console output.
      float field = mod(floor(uTime * 30.0), 2.0) * 2.0 - 1.0;
      float jitterStrength = uMotion * 0.34 + uFeedback * (0.24 + uError * 0.72);
      vec2 jitter = vec2(field * texel.x * jitterStrength, 0.0);
      vec2 snappedUv = (pixel + 0.5) * texel + jitter;

      vec3 signal = sampleSignal(snappedUv, texel);

      // Red and blue arrive one texel apart, like a slightly tired component cable.
      float bleed = 0.18 + uFeedback * 0.18;
      float red = texture2D(tDiffuse, snappedUv + vec2(texel.x, 0.0)).r;
      float blue = texture2D(tDiffuse, snappedUv - vec2(texel.x, 0.0)).b;
      signal.r = mix(signal.r, red, bleed);
      signal.b = mix(signal.b, blue, bleed * 0.82);

      float threshold = bayer4(pixel) - 0.5;
      float levels = max(8.0, uLevels - uError * uFeedback * 7.0);
      vec3 quantized = floor(signal * levels + 0.5 + threshold * 0.78) / levels;
      float luma = dot(signal, vec3(0.299, 0.587, 0.114));
      float ditherMask = 1.0 - smoothstep(0.68, 1.0, luma) * 0.44;
      vec3 color = mix(signal, quantized, uAmount * ditherMask);

      // Keep interlace texture restrained; it should be felt more than noticed.
      float scanline = mod(pixel.y, 2.0);
      color *= 1.0 - scanline * (0.022 + uFeedback * 0.018);
      color *= vec3(1.015, 0.995, 0.965);

      vec3 errorTint = vec3(color.r * 1.12, color.g * 0.76, color.b * 0.7);
      color = mix(color, errorTint, uError * uFeedback * 0.2);

      vec2 centered = vUv * 2.0 - 1.0;
      float vignette = 1.0 - smoothstep(0.28, 1.35, dot(centered, centered));
      color *= mix(0.82, 1.0, vignette);
      gl_FragColor = vec4(color, 1.0);
    }
  `
};

/**
 * Shared low-resolution console treatment with short gameplay-reactive signal
 * pulses. The historical class name is kept so scene imports remain stable.
 */
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
    const lowResolutionTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false
    });
    lowResolutionTarget.texture.name = "PS2 low-resolution color buffer";

    this.composer = new EffectComposer(renderer, lowResolutionTarget);
    this.composer.setPixelRatio(1);
    this.composer.addPass(new RenderPass(scene, camera));
    this.pass = new ShaderPass(PS2_SIGNAL_SHADER);
    this.uniforms = this.pass.uniforms as unknown as DitherUniforms;
    this.composer.addPass(this.pass);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    const scale = Math.min(1, MAX_INTERNAL_WIDTH / width, MAX_INTERNAL_HEIGHT / height);
    const internalWidth = Math.max(1, Math.floor(width * scale));
    const internalHeight = Math.max(1, Math.floor(height * scale));
    this.composer.setSize(internalWidth, internalHeight);
    this.uniforms.uResolution.value.set(internalWidth, internalHeight);
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
    this.uniforms.uMotion.value = this.reducedMotion ? 0 : this.motion;
    this.uniforms.uTime.value = this.elapsed;
    this.uniforms.uAmount.value = 0.3 - this.motion * 0.055;
    this.uniforms.uLevels.value = 22 + this.motion * 7;
    this.composer.render(delta);
  }

  dispose(): void {
    this.pass.dispose();
    this.composer.dispose();
  }
}
