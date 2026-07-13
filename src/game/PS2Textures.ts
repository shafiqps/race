import * as THREE from "three";

export type PS2Surface = "asphalt" | "concrete" | "metal";

const TEXTURE_SIZE = 64;

/** Creates a tiny deterministic surface map so texels stay visible in motion. */
export function createPS2SurfaceTexture(
  surface: PS2Surface,
  repeatX: number,
  repeatY: number
): THREE.DataTexture {
  const data = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const seed = surface === "asphalt" ? 19 : surface === "concrete" ? 47 : 83;

  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const offset = (y * TEXTURE_SIZE + x) * 4;
      const noise = hash2d(x, y, seed);
      const broadNoise = hash2d(Math.floor(x / 4), Math.floor(y / 4), seed + 11);
      let value = 202 + (noise - 0.5) * 34 + (broadNoise - 0.5) * 25;

      if (surface === "asphalt") {
        const aggregate = hash2d(x * 3, y * 5, seed + 29);
        if (aggregate > 0.9) value += 30;
        if (aggregate < 0.055) value -= 45;
        if ((x + Math.floor(y * 0.42)) % 31 === 0 && noise > 0.44) value -= 28;
      } else if (surface === "concrete") {
        if (x % 32 === 0 || y % 32 === 0) value -= 32;
        if ((x + y * 2) % 37 === 0 && noise > 0.5) value -= 20;
      } else {
        const seam = x % 16 === 0 || y % 16 === 0;
        value += y % 4 === 0 ? 8 : -4;
        if (seam) value -= 38;
        const bolt = (x % 16 === 2 || x % 16 === 13) && (y % 16 === 2 || y % 16 === 13);
        if (bolt) value = 112;
      }

      const channel = Math.round(THREE.MathUtils.clamp(value, 72, 244));
      data[offset] = channel;
      data[offset + 1] = Math.max(0, channel - (surface === "asphalt" ? 4 : 1));
      data[offset + 2] = Math.max(0, channel - (surface === "metal" ? 0 : 7));
      data[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, TEXTURE_SIZE, TEXTURE_SIZE, THREE.RGBAFormat);
  texture.name = `PS2 ${surface} 64px surface`;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 1;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(repeatX, repeatY);
  texture.needsUpdate = true;
  return texture;
}

function hash2d(x: number, y: number, seed: number): number {
  let value = Math.imul(x + seed, 374761393) ^ Math.imul(y + seed * 3, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}
