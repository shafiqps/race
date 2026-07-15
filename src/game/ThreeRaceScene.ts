import * as THREE from "three";
import type { Player } from "../../shared/types";
import { animateHoverRobot, createHoverRobot, type HoverRobot } from "./HoverRobot";
import { CyberpunkDitherPipeline } from "./CyberpunkDitherPipeline";
import { createPS2SurfaceTexture } from "./PS2Textures";

type RunnerMesh = HoverRobot;

interface SpeedGate {
  root: THREE.Group;
  phase: number;
}

interface TunnelStrip {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  phase: number;
}

interface BurstParticle {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

const TRACK_LENGTH = 56;
const LANE_WIDTH = 3.2;
const AMBIENT_STREAKS = 90;

export class ThreeRaceScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 250);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  private readonly dither: CyberpunkDitherPipeline;
  private readonly runners = new Map<string, RunnerMesh>();
  private readonly clock = new THREE.Clock();
  private readonly speedGates: SpeedGate[] = [];
  private readonly tunnelStrips: TunnelStrip[] = [];
  private readonly burstParticles: BurstParticle[] = [];
  private readonly surfaceTextures: THREE.Texture[] = [];
  private ambientStreaks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
  private ambientPositions: Float32Array | null = null;
  private frame = 0;
  private disposed = false;
  private players: Player[] = [];
  private stumble = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly focusPlayerId: string | undefined
  ) {
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x070806);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.dither = new CyberpunkDitherPipeline(
      this.renderer,
      this.scene,
      this.camera,
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
    this.renderer.domElement.className = "race-canvas";
    this.container.append(this.renderer.domElement);

    this.camera.position.set(0, 5.2, 12);
    this.camera.lookAt(0, 1.2, -8);

    this.buildWorld();
    this.resize();
    window.addEventListener("resize", this.resize);
    this.animate();
  }

  updatePlayers(players: Player[]): void {
    this.players = players;
    players.forEach((player, index) => {
      if (!this.runners.has(player.id)) {
        const runner = this.createRunner(player.color);
        runner.root.position.x = laneX(index, players.length);
        this.scene.add(runner.root);
        this.runners.set(player.id, runner);
      }
    });

    for (const [id, runner] of this.runners) {
      if (!players.some((player) => player.id === id)) {
        this.scene.remove(runner.root);
        this.runners.delete(id);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.resize);
    this.surfaceTextures.forEach((texture) => texture.dispose());
    this.dither.dispose();
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  private buildWorld(): void {
    this.scene.fog = new THREE.Fog(0x070806, 28, 98);

    const groundTexture = createPS2SurfaceTexture("concrete", 18, 26);
    const trackTexture = createPS2SurfaceTexture("asphalt", 5, 18);
    const wallTexture = createPS2SurfaceTexture("metal", 2, 18);
    this.surfaceTextures.push(groundTexture, trackTexture, wallTexture);

    const hemi = new THREE.HemisphereLight(0xe9e0c8, 0x101513, 1.4);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xff3a2f, 2.1);
    sun.position.set(-18, 22, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.scene.add(sun);

    const cyan = new THREE.PointLight(0x75f4ff, 2.8, 42);
    cyan.position.set(9, 5, -18);
    this.scene.add(cyan);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 130),
      new THREE.MeshStandardMaterial({ color: 0x0b0d0b, map: groundTexture, roughness: 1, metalness: 0.15 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -22;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const track = new THREE.Mesh(
      new THREE.BoxGeometry(24, 0.35, TRACK_LENGTH + 8),
      new THREE.MeshStandardMaterial({ color: 0x161815, map: trackTexture, roughness: 0.82, metalness: 0.12 })
    );
    track.position.set(0, 0, -TRACK_LENGTH / 2 + 2);
    track.receiveShadow = true;
    this.scene.add(track);

    for (let i = -3; i <= 3; i += 1) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(i === 0 ? 0.05 : 0.08, 0.05, TRACK_LENGTH + 2),
        new THREE.MeshStandardMaterial({
          color: i === 0 ? 0xff3a2f : 0xd8d1bd,
          emissive: i === 0 ? 0x4a0805 : 0x11100c,
          roughness: 0.7
        })
      );
      stripe.position.set(i * LANE_WIDTH, 0.23, -TRACK_LENGTH / 2 + 2);
      this.scene.add(stripe);
    }

    const finish = new THREE.Mesh(
      new THREE.BoxGeometry(24, 0.08, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x75f4ff, emissive: 0x12383c, roughness: 0.5 })
    );
    finish.position.set(0, 0.32, -TRACK_LENGTH);
    this.scene.add(finish);

    for (let x = -11.4; x <= 11.4; x += 1.9) {
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.1, 0.55),
        new THREE.MeshStandardMaterial({ color: Math.round(x) % 2 === 0 ? 0x070806 : 0xd8d1bd })
      );
      tile.position.set(x, 0.39, -TRACK_LENGTH + 0.02);
      this.scene.add(tile);
    }

    this.addInfrastructure();
    this.addAmbientStreaks();
  }

  emitTypingEffect(correct: boolean, flowLevel = 0): void {
    this.dither.pulse(correct);
    const runner = this.focusRunner();
    if (!runner) return;
    const origin = runner.root.position.clone().add(new THREE.Vector3(0, 1.1, -0.35));
    const count = correct ? 5 + flowLevel * 2 : 9;
    for (let i = 0; i < count; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: correct ? 0x75f4ff : 0xff3a2f,
        transparent: true,
        opacity: correct ? 0.82 : 0.95
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(correct ? 0.045 : 0.07, 0.045, correct ? 0.2 : 0.07), material);
      mesh.position.copy(origin);
      const spread = correct ? 0.035 : 0.075;
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * spread,
        0.025 + Math.random() * 0.045,
        -0.07 - Math.random() * 0.09
      );
      this.burstParticles.push({ mesh, velocity, life: correct ? 18 : 24, maxLife: correct ? 18 : 24 });
      this.scene.add(mesh);
    }
  }

  triggerStumble(): void {
    this.stumble = 1;
  }

  triggerFinishBurst(): void {
    const runner = this.focusRunner();
    if (!runner) return;
    const origin = runner.root.position.clone().add(new THREE.Vector3(0, 1.4, -0.45));
    for (let i = 0; i < 42; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? 0xff3a2f : 0x75f4ff,
        transparent: true,
        opacity: 0.95
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.32), material);
      mesh.position.copy(origin);
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.05 + Math.random() * 0.16;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * radius,
        (Math.random() - 0.15) * 0.14,
        Math.sin(angle) * radius - 0.1
      );
      this.burstParticles.push({ mesh, velocity, life: 42, maxLife: 42 });
      this.scene.add(mesh);
    }
  }

  private addInfrastructure(): void {
    const pylonMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d1bd, roughness: 0.82, metalness: 0.26 });
    const redMaterial = new THREE.MeshStandardMaterial({ color: 0xff3a2f, emissive: 0x4a0805, roughness: 0.62 });
    const cyanMaterial = new THREE.MeshBasicMaterial({ color: 0x75f4ff, transparent: true, opacity: 0.44 });

    const grid = new THREE.GridHelper(100, 50, 0x75f4ff, 0x222923);
    grid.position.y = 0.03;
    grid.position.z = -24;
    this.scene.add(grid);

    for (let i = 0; i < 22; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = 6 - i * 4.4;
      const x = side * (16 + (i % 4) * 0.8);
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.18, 5.8, 0.18), pylonMaterial);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.5), redMaterial);
      pylon.position.set(x, 2.9, z);
      plate.position.set(x - side * 1.1, 4.6, z);
      pylon.castShadow = true;
      plate.castShadow = true;
      this.scene.add(pylon, plate);

      if (i % 3 === 0) {
        const scan = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.4, 1, 1), cyanMaterial);
        scan.position.set(x - side * 1.4, 2.6, z - 1.2);
        scan.rotation.y = side * Math.PI * 0.5;
        this.scene.add(scan);
      }
    }

    this.addDataTunnel();
    this.addSpeedGates();
  }

  private addDataTunnel(): void {
    const wallTexture = this.surfaceTextures[2];
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x0b0d0c,
      map: wallTexture,
      roughness: 0.82,
      metalness: 0.28
    });
    const cyanMaterial = new THREE.MeshBasicMaterial({ color: 0x75f4ff, transparent: true, opacity: 0.42 });
    const redMaterial = new THREE.MeshBasicMaterial({ color: 0xff3a2f, transparent: true, opacity: 0.5 });

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.55, 5.2, TRACK_LENGTH + 12), wallMaterial);
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.55, 5.2, TRACK_LENGTH + 12), wallMaterial.clone());
    leftWall.position.set(-13.2, 2.45, -TRACK_LENGTH / 2 + 2);
    rightWall.position.set(13.2, 2.45, -TRACK_LENGTH / 2 + 2);
    this.scene.add(leftWall, rightWall);

    for (let z = 5; z > -TRACK_LENGTH - 4; z -= 4) {
      const sidePulse = Math.abs(z) * 0.17;
      const leftStrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.4), cyanMaterial.clone());
      const rightStrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.4), redMaterial.clone());
      leftStrip.position.set(-12.86, 3.8, z);
      rightStrip.position.set(12.86, 3.1, z - 1.2);
      this.tunnelStrips.push({ mesh: leftStrip, phase: sidePulse });
      this.tunnelStrips.push({ mesh: rightStrip, phase: sidePulse + 1.7 });
      this.scene.add(leftStrip, rightStrip);

      const floorPulse = new THREE.Mesh(new THREE.BoxGeometry(18.8, 0.035, 0.12), z % 8 === 0 ? redMaterial.clone() : cyanMaterial.clone());
      floorPulse.position.set(0, 0.48, z - 0.7);
      this.tunnelStrips.push({ mesh: floorPulse, phase: sidePulse + 2.4 });
      this.scene.add(floorPulse);
    }
  }

  private addSpeedGates(): void {
    const material = new THREE.MeshBasicMaterial({ color: 0xff3a2f, transparent: true, opacity: 0.66 });
    const cyanMaterial = new THREE.MeshBasicMaterial({ color: 0x75f4ff, transparent: true, opacity: 0.42 });
    for (let z = -4; z > -TRACK_LENGTH + 6; z -= 7) {
      const root = new THREE.Group();
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.8, 0.12), material.clone());
      const right = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.8, 0.12), material.clone());
      const top = new THREE.Mesh(new THREE.BoxGeometry(24.4, 0.08, 0.08), cyanMaterial.clone());
      const brace = new THREE.Mesh(new THREE.BoxGeometry(18, 0.05, 0.05), material.clone());
      left.position.set(-12.4, 2.55, 0);
      right.position.set(12.4, 2.55, 0);
      top.position.set(0, 5, 0);
      brace.position.set(0, 4.15, 0);
      brace.rotation.z = Math.PI * 0.025;
      root.position.z = z;
      root.add(left, right, top, brace);
      this.speedGates.push({ root, phase: Math.abs(z) * 0.21 });
      this.scene.add(root);
    }
  }

  private addAmbientStreaks(): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(AMBIENT_STREAKS * 3);
    for (let i = 0; i < AMBIENT_STREAKS; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 31;
      positions[i * 3 + 1] = 0.8 + Math.random() * 5.8;
      positions[i * 3 + 2] = 8 - Math.random() * (TRACK_LENGTH + 18);
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0x75f4ff,
      size: 0.05,
      transparent: true,
      opacity: 0.48,
      depthWrite: false
    });
    this.ambientPositions = positions;
    this.ambientStreaks = new THREE.Points(geometry, material);
    this.scene.add(this.ambientStreaks);
  }

  private createRunner(color: string): RunnerMesh {
    const robot = createHoverRobot(color);
    robot.root.position.z = 3.5;
    return robot;
  }

  private animate = (): void => {
    if (this.disposed) return;
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;
    this.stumble = Math.max(0, this.stumble - delta * 3.2);

    const focusPlayer =
      this.players.find((player) => player.id === this.focusPlayerId) ??
      this.players.reduce<Player | null>((leader, player) => {
        if (!leader || player.progress > leader.progress) return player;
        return leader;
      }, null);
    const focusFlow = focusPlayer?.flowLevel ?? 0;

    this.animateDistrict(elapsed, focusFlow);

    this.players.forEach((player, index) => {
      const runner = this.runners.get(player.id);
      if (!runner) return;
      const targetZ = 3.5 - player.progress * (TRACK_LENGTH + 3.5);
      runner.root.position.x += (laneX(index, this.players.length) - runner.root.position.x) * 0.08;
      runner.root.position.z += (targetZ - runner.root.position.z) * 0.08;
      const speedRatio = THREE.MathUtils.clamp(player.wpm / 120 + player.flowLevel * 0.09, 0, 1);
      animateHoverRobot(runner, elapsed, speedRatio, index * 0.9);
      runner.body.rotation.z = Math.sin(elapsed * 6 + index) * (0.025 + speedRatio * 0.07);
      runner.root.rotation.x = -speedRatio * 0.1;
      if (player.id === this.focusPlayerId && this.stumble > 0) {
        const shake = Math.sin(elapsed * 48) * this.stumble;
        runner.body.rotation.z += shake * 0.16;
        runner.head.rotation.z += shake * 0.08;
        runner.root.position.x += shake * 0.025;
      }
    });

    const focusRunner = focusPlayer ? this.runners.get(focusPlayer.id) : null;

    if (focusRunner) {
      const targetCamera = new THREE.Vector3(
        focusRunner.root.position.x + Math.sin(elapsed * 52) * this.stumble * 0.08,
        4.6,
        focusRunner.root.position.z + 8.6
      );
      const targetLook = new THREE.Vector3(
        focusRunner.root.position.x,
        1.35,
        focusRunner.root.position.z - 9
      );
      this.camera.position.lerp(targetCamera, 0.07);
      this.camera.lookAt(targetLook);
    }

    const focusSpeed = focusPlayer
      ? THREE.MathUtils.clamp(focusPlayer.wpm / 120 + focusFlow * 0.1, 0, 1)
      : 0;
    const targetFov = 52 + focusFlow * 1.8 - this.stumble * 1.2;
    this.camera.fov += (targetFov - this.camera.fov) * 0.08;
    this.camera.updateProjectionMatrix();
    this.dither.setMotion(THREE.MathUtils.clamp(focusSpeed + this.stumble * 0.18, 0, 1));
    this.dither.render(delta);
    this.frame = requestAnimationFrame(this.animate);
  };

  private animateDistrict(elapsed: number, flowLevel: number): void {
    this.animateAmbientStreaks(flowLevel);
    this.animateBurstParticles();

    this.speedGates.forEach((gate) => {
      const pulse = 0.48 + flowLevel * 0.08 + Math.sin(elapsed * (4.4 + flowLevel) + gate.phase) * 0.16;
      gate.root.scale.y = 1 + flowLevel * 0.018;
      gate.root.children.forEach((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
          child.material.opacity = pulse;
        }
      });
    });

    this.tunnelStrips.forEach((strip) => {
      strip.mesh.material.opacity = 0.24 + flowLevel * 0.055 + Math.sin(elapsed * (5.2 + flowLevel) + strip.phase) * 0.18;
      strip.mesh.scale.z = 0.76 + flowLevel * 0.08 + Math.sin(elapsed * 2.8 + strip.phase) * 0.22;
    });
  }

  private animateAmbientStreaks(flowLevel: number): void {
    if (!this.ambientStreaks || !this.ambientPositions) return;
    for (let i = 0; i < AMBIENT_STREAKS; i += 1) {
      const zIndex = i * 3 + 2;
      this.ambientPositions[zIndex] += 0.34 + flowLevel * 0.09 + (i % 7) * 0.025;
      if (this.ambientPositions[zIndex] > 9) {
        this.ambientPositions[i * 3] = (Math.random() - 0.5) * 31;
        this.ambientPositions[i * 3 + 1] = 0.8 + Math.random() * 5.8;
        this.ambientPositions[zIndex] = -TRACK_LENGTH - 9;
      }
    }
    this.ambientStreaks.geometry.attributes.position.needsUpdate = true;
  }

  private animateBurstParticles(): void {
    for (let i = this.burstParticles.length - 1; i >= 0; i -= 1) {
      const particle = this.burstParticles[i];
      particle.life -= 1;
      particle.mesh.position.add(particle.velocity);
      particle.velocity.y -= 0.002;
      particle.mesh.rotation.x += 0.18;
      particle.mesh.rotation.z += 0.11;
      particle.mesh.material.opacity = Math.max(0, particle.life / particle.maxLife);
      if (particle.life <= 0) {
        this.scene.remove(particle.mesh);
        particle.mesh.geometry.dispose();
        particle.mesh.material.dispose();
        this.burstParticles.splice(i, 1);
      }
    }
  }

  private focusRunner(): RunnerMesh | null {
    const focusPlayer =
      this.players.find((player) => player.id === this.focusPlayerId) ??
      this.players.reduce<Player | null>((leader, player) => {
        if (!leader || player.progress > leader.progress) return player;
        return leader;
      }, null);
    return focusPlayer ? this.runners.get(focusPlayer.id) ?? null : null;
  }

  private resize = (): void => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.dither.setSize(width, height);
  };
}

function laneX(index: number, total: number): number {
  return (index - (total - 1) / 2) * LANE_WIDTH;
}
