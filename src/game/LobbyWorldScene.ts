import * as THREE from "three";

interface SceneQuality {
  mobile: boolean;
  towers: number;
  traffic: number;
  rain: number;
  signs: number;
  fogBanks: number;
  pixelRatio: number;
}

interface TowerBlueprint {
  x: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  seed: number;
  side: number;
  tiered: boolean;
  tapered: boolean;
  hero: boolean;
}

interface InstanceTransform {
  position: THREE.Vector3;
  scale: THREE.Vector3;
  rotation: THREE.Quaternion;
  color?: THREE.Color;
  seed?: number;
}

interface SkyVehicle {
  axis: "x" | "z";
  base: number;
  lane: number;
  altitude: number;
  speed: number;
  phase: number;
  direction: 1 | -1;
  color: THREE.Color;
}

interface RainDrop {
  x: number;
  z: number;
  baseY: number;
  speed: number;
  length: number;
  drift: number;
}

interface Hologram {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  baseY: number;
  baseWidth: number;
  phase: number;
  baseOpacity: number;
}

interface FogBank {
  sprite: THREE.Sprite;
  baseX: number;
  baseY: number;
  speed: number;
  phase: number;
}

interface LobbyBeacon {
  root: THREE.Group;
  rings: Array<THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>>;
  core: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial>;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  light: THREE.PointLight;
}

const VOID = 0x030507;
const FOG = 0x060a0d;
const SIGNAL = 0xff4d3d;
const CYAN = 0x74eadc;
const STEEL = 0x11191e;
const WORLD_MIN = -230;
const WORLD_MAX = 58;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class LobbyWorldScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 420);
  private readonly renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance"
  });
  private readonly clock = new THREE.Clock();
  private readonly quality = chooseQuality();
  private readonly random: () => number;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private readonly pointerTarget = new THREE.Vector2();
  private readonly pointer = new THREE.Vector2();
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchPosition = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();
  private readonly scratchQuaternion = new THREE.Quaternion();
  private readonly traffic: SkyVehicle[] = [];
  private readonly rainDrops: RainDrop[] = [];
  private readonly holograms: Hologram[] = [];
  private readonly fogBanks: FogBank[] = [];
  private facadeMaterial: THREE.ShaderMaterial | null = null;
  private trafficBody: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> | null = null;
  private trafficCore: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | null = null;
  private trafficTrail: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | null = null;
  private rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  private rainPositions: Float32Array | null = null;
  private beacon: LobbyBeacon | null = null;
  private stormLight: THREE.DirectionalLight | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private baseCameraY = 18;
  private baseCameraZ = 52;
  private targetCameraY = 23;
  private activity = 0;
  private activityTarget = 0;
  private joinSurge = 0;
  private frame = 0;
  private disposed = false;
  private suspended = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly channelCode = "GRID"
  ) {
    this.random = mulberry32(hashString(channelCode));
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setClearColor(VOID);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.domElement.className = "lobby-canvas";
    this.container.append(this.renderer.domElement);

    this.buildWorld();
    this.resize();

    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(this.container);
    window.addEventListener("resize", this.resize);
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.animate();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("pointermove", this.onPointerMove);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.disposeSceneResources();
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  updateActivity(playerCount: number, readyCount: number): void {
    const playerSignal = THREE.MathUtils.clamp(playerCount / 6, 0, 1);
    const readySignal = playerCount > 0 ? THREE.MathUtils.clamp(readyCount / playerCount, 0, 1) : 0;
    const nextTarget = 0.12 + playerSignal * 0.56 + readySignal * 0.32;
    if (nextTarget > this.activityTarget + 0.02) this.joinSurge = 1;
    this.activityTarget = nextTarget;
  }

  private buildWorld(): void {
    this.scene.background = new THREE.Color(VOID);
    this.scene.fog = new THREE.Fog(FOG, 54, 330);

    const hemisphere = new THREE.HemisphereLight(0x91adb3, 0x010203, 0.88);
    this.scene.add(hemisphere);

    const signalLight = new THREE.PointLight(SIGNAL, 22, 118, 1.7);
    signalLight.position.set(-20, 28, 18);
    this.scene.add(signalLight);

    const cyanLight = new THREE.PointLight(CYAN, 18, 150, 1.8);
    cyanLight.position.set(24, 36, -50);
    this.scene.add(cyanLight);

    this.stormLight = new THREE.DirectionalLight(0xb4dce5, 0);
    this.stormLight.position.set(-40, 120, -80);
    this.scene.add(this.stormLight);

    this.addSkyGradient();
    this.addForegroundDeck();

    const towers = this.generateTowerBlueprints();
    this.addTowerDistrict(towers);
    this.addSkyBridges();
    this.addUtilityCables();
    this.addHolograms();
    this.addTraffic();
    this.addLobbyBeacon();
    this.addRain();
    this.addFogBanks();
  }

  private addSkyGradient(): void {
    const geometry = new THREE.SphereGeometry(310, 24, 14);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x020305) },
        uBottom: { value: new THREE.Color(0x101419) }
      },
      vertexShader: `
        varying float vHeight;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vHeight = normalize(world.xyz).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uTop;
        uniform vec3 uBottom;
        varying float vHeight;
        void main() {
          float mixValue = smoothstep(-0.2, 0.72, vHeight);
          vec3 color = mix(uBottom, uTop, mixValue);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    });
    const dome = new THREE.Mesh(geometry, material);
    dome.position.set(0, 38, -80);
    this.scene.add(dome);
  }

  private addForegroundDeck(): void {
    const boulevard = new THREE.Mesh(
      new THREE.PlaneGeometry(38, 280),
      new THREE.MeshStandardMaterial({ color: 0x070a0c, roughness: 0.34, metalness: 0.72 })
    );
    boulevard.rotation.x = -Math.PI / 2;
    boulevard.position.set(0, -0.08, -88);
    this.scene.add(boulevard);

    const deck = new THREE.Mesh(
      new THREE.CylinderGeometry(30, 36, 0.65, 8),
      new THREE.MeshStandardMaterial({ color: 0x0a0e10, roughness: 0.42, metalness: 0.62 })
    );
    deck.position.set(0, -0.42, 5);
    deck.rotation.y = Math.PI * 0.125;
    this.scene.add(deck);

    const grid = new THREE.GridHelper(110, 55, CYAN, 0x182125);
    grid.position.set(0, 0.02, -20);
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material];
    materials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.19;
      material.depthWrite = false;
    });
    this.scene.add(grid);

    const laneGeometry = new THREE.BoxGeometry(0.055, 0.025, 7.5);
    const laneMaterial = new THREE.MeshBasicMaterial({ color: SIGNAL, transparent: true, opacity: 0.4 });
    const lanes = new THREE.InstancedMesh(laneGeometry, laneMaterial, 72);
    let laneIndex = 0;
    for (let z = 24; z > -180; z -= 8.5) {
      [-8.7, 0, 8.7].forEach((x) => {
        if (laneIndex >= lanes.count) return;
        this.scratchMatrix.compose(
          this.scratchPosition.set(x, 0.07, z),
          this.scratchQuaternion.identity(),
          this.scratchScale.set(1, 1, 1)
        );
        lanes.setMatrixAt(laneIndex, this.scratchMatrix);
        laneIndex += 1;
      });
    }
    lanes.count = laneIndex;
    lanes.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    this.scene.add(lanes);

    const curbGeometry = new THREE.BoxGeometry(0.12, 0.1, 280);
    const cyanCurb = new THREE.Mesh(curbGeometry, new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.34 }));
    const redCurb = new THREE.Mesh(curbGeometry, new THREE.MeshBasicMaterial({ color: SIGNAL, transparent: true, opacity: 0.42 }));
    cyanCurb.position.set(-18.8, 0.04, -88);
    redCurb.position.set(18.8, 0.04, -88);
    this.scene.add(cyanCurb, redCurb);
  }

  private generateTowerBlueprints(): TowerBlueprint[] {
    const towers: TowerBlueprint[] = [];
    const heroPairs = Math.min(22, Math.floor(this.quality.towers * 0.22));

    for (let pair = 0; pair < heroPairs; pair += 1) {
      for (const side of [-1, 1]) {
        const z = 26 - pair * (8.8 + this.random() * 2.8);
        const width = 7 + this.random() * 8;
        const depth = 6 + this.random() * 9;
        const height = 42 + this.random() * 82 + pair * 1.35;
        const x = side * (19 + this.random() * 15 + (pair % 3) * 2.5);
        towers.push({
          x,
          z,
          width,
          height,
          depth,
          seed: this.random() * 100,
          side,
          tiered: this.random() > 0.42,
          tapered: this.random() > 0.72,
          hero: true
        });
      }
    }

    while (towers.length < this.quality.towers) {
      const depth = this.random();
      const z = 12 - depth * 292;
      const side = this.random() > 0.5 ? 1 : -1;
      const width = 4.5 + this.random() * (8 + depth * 4);
      const footprintDepth = 4.5 + this.random() * 10;
      const height = 24 + this.random() * 86 + depth * 48;
      const corridor = 24 + depth * 12;
      const x = side * (corridor + this.random() * (32 + depth * 30));
      towers.push({
        x,
        z,
        width,
        height,
        depth: footprintDepth,
        seed: this.random() * 100,
        side,
        tiered: this.random() > 0.58,
        tapered: this.random() > 0.82,
        hero: false
      });
    }

    return towers;
  }

  private addTowerDistrict(towers: TowerBlueprint[]): void {
    const boxTransforms: InstanceTransform[] = [];
    const taperTransforms: InstanceTransform[] = [];
    const frontFacades: InstanceTransform[] = [];
    const sideFacades: InstanceTransform[] = [];
    const rooftopTransforms: InstanceTransform[] = [];
    const spireTransforms: InstanceTransform[] = [];
    const warningLights: number[] = [];

    towers.forEach((tower, index) => {
      const colorLift = tower.hero ? 0.032 : 0.012;
      const color = new THREE.Color(STEEL).offsetHSL(
        (this.random() - 0.5) * 0.025,
        this.random() * 0.08,
        colorLift + this.random() * 0.025
      );
      const mainTransform: InstanceTransform = {
        position: new THREE.Vector3(tower.x, tower.height / 2, tower.z),
        scale: new THREE.Vector3(tower.width, tower.height, tower.depth),
        rotation: new THREE.Quaternion(),
        color
      };
      (tower.tapered ? taperTransforms : boxTransforms).push(mainTransform);

      if (tower.tiered) {
        const tierHeight = tower.height * (0.16 + this.random() * 0.13);
        const tierTransform: InstanceTransform = {
          position: new THREE.Vector3(tower.x, tower.height + tierHeight / 2, tower.z),
          scale: new THREE.Vector3(tower.width * 0.62, tierHeight, tower.depth * 0.64),
          rotation: new THREE.Quaternion(),
          color: color.clone().offsetHSL(0, 0, 0.018)
        };
        boxTransforms.push(tierTransform);
      }

      const facadeHeight = tower.height * 0.84;
      frontFacades.push({
        position: new THREE.Vector3(tower.x, tower.height * 0.49, tower.z + tower.depth / 2 + 0.04),
        scale: new THREE.Vector3(tower.width * 0.82, facadeHeight, 1),
        rotation: new THREE.Quaternion(),
        seed: tower.seed
      });

      if (Math.abs(tower.x) < 58 || tower.hero) {
        sideFacades.push({
          position: new THREE.Vector3(
            tower.x - tower.side * (tower.width / 2 + 0.04),
            tower.height * 0.49,
            tower.z
          ),
          scale: new THREE.Vector3(tower.depth * 0.84, facadeHeight, 1),
          rotation: new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            -tower.side * Math.PI * 0.5
          ),
          seed: tower.seed + 12.7
        });
      }

      if (tower.hero || this.random() > 0.42) {
        const roofHeight = tower.tiered ? tower.height * 1.18 : tower.height;
        rooftopTransforms.push({
          position: new THREE.Vector3(
            tower.x + (this.random() - 0.5) * tower.width * 0.4,
            roofHeight + 0.7,
            tower.z + (this.random() - 0.5) * tower.depth * 0.36
          ),
          scale: new THREE.Vector3(
            0.8 + this.random() * 1.6,
            1 + this.random() * 1.8,
            0.8 + this.random() * 1.6
          ),
          rotation: new THREE.Quaternion(),
          color: new THREE.Color(0x171d20)
        });
      }

      if (tower.hero || this.random() > 0.72) {
        const spireHeight = 4 + this.random() * 13;
        const roofHeight = tower.tiered ? tower.height * 1.2 : tower.height;
        spireTransforms.push({
          position: new THREE.Vector3(tower.x, roofHeight + spireHeight / 2, tower.z),
          scale: new THREE.Vector3(0.11, spireHeight, 0.11),
          rotation: new THREE.Quaternion(),
          color: new THREE.Color(index % 5 === 0 ? SIGNAL : 0x68767a)
        });
        warningLights.push(tower.x, roofHeight + spireHeight + 0.25, tower.z);
      }
    });

    const steelMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.58,
      metalness: 0.48,
      vertexColors: true
    });
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.addStaticInstances(boxGeometry, steelMaterial, boxTransforms);

    const taperGeometry = new THREE.CylinderGeometry(0.72, 1, 1, 4, 1, false);
    taperGeometry.rotateY(Math.PI * 0.25);
    this.addStaticInstances(taperGeometry, steelMaterial.clone(), taperTransforms);

    const rooftopMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.64,
      metalness: 0.42,
      vertexColors: true
    });
    this.addStaticInstances(new THREE.BoxGeometry(1, 1, 1), rooftopMaterial, rooftopTransforms);

    const spireMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    this.addStaticInstances(new THREE.CylinderGeometry(1, 1, 1, 5), spireMaterial, spireTransforms);

    this.facadeMaterial = this.createFacadeMaterial();
    this.addFacadeInstances(frontFacades, this.facadeMaterial);
    this.addFacadeInstances(sideFacades, this.facadeMaterial);

    if (warningLights.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(warningLights, 3));
      const material = new THREE.PointsMaterial({
        color: SIGNAL,
        size: this.quality.mobile ? 0.25 : 0.34,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      this.scene.add(new THREE.Points(geometry, material));
    }
  }

  private addStaticInstances<G extends THREE.BufferGeometry, M extends THREE.Material>(
    geometry: G,
    material: M,
    transforms: InstanceTransform[]
  ): THREE.InstancedMesh<G, M> | null {
    if (transforms.length === 0) {
      geometry.dispose();
      material.dispose();
      return null;
    }
    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
    transforms.forEach((transform, index) => {
      this.scratchMatrix.compose(transform.position, transform.rotation, transform.scale);
      mesh.setMatrixAt(index, this.scratchMatrix);
      if (transform.color) mesh.setColorAt(index, transform.color);
    });
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
    return mesh;
  }

  private addFacadeInstances(
    transforms: InstanceTransform[],
    material: THREE.ShaderMaterial
  ): void {
    if (transforms.length === 0) return;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const seeds = new Float32Array(transforms.length);
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
    transforms.forEach((transform, index) => {
      this.scratchMatrix.compose(transform.position, transform.rotation, transform.scale);
      mesh.setMatrixAt(index, this.scratchMatrix);
      seeds[index] = transform.seed ?? index;
    });
    geometry.attributes.aSeed.needsUpdate = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
  }

  private createFacadeMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      fog: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uTime: { value: 0 } }
      ]),
      vertexShader: `
        attribute float aSeed;
        varying vec2 vUv;
        varying float vSeed;
        #include <fog_pars_vertex>

        void main() {
          vUv = uv;
          vSeed = aSeed;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying float vSeed;
        #include <fog_pars_fragment>

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        void main() {
          vec2 gridSize = vec2(7.0 + mod(floor(vSeed), 5.0), 34.0 + mod(floor(vSeed * 3.7), 22.0));
          vec2 grid = vUv * gridSize;
          vec2 cell = fract(grid);
          vec2 cellId = floor(grid) + vSeed;
          float aperture = step(0.18, cell.x) * step(cell.x, 0.76) * step(0.24, cell.y) * step(cell.y, 0.54);
          float room = hash21(cellId);
          float occupied = step(0.82, room);
          float flutter = 0.72 + 0.28 * step(0.28, hash21(cellId + floor(uTime * 0.17)));
          float elevator = smoothstep(0.88, 1.0, sin((vUv.y * 9.0 - uTime * 0.32) + vSeed) * 0.5 + 0.5);
          float light = aperture * max(occupied * flutter, elevator * step(0.7, hash21(vec2(vSeed, floor(grid.x)))));

          float palette = hash21(vec2(vSeed, 8.4));
          vec3 dirtyAmber = vec3(0.86, 0.43, 0.16);
          vec3 coldCyan = vec3(0.22, 0.92, 0.86);
          vec3 warningRed = vec3(1.0, 0.12, 0.07);
          vec3 color = palette < 0.62 ? dirtyAmber : coldCyan;
          color = palette > 0.93 ? warningRed : color;
          float alpha = light * (0.34 + room * 0.46);
          if (alpha < 0.035) discard;
          gl_FragColor = vec4(color, alpha);
          #include <fog_fragment>
        }
      `
    });
  }

  private addSkyBridges(): void {
    const count = this.quality.mobile ? 8 : 14;
    const deckTransforms: InstanceTransform[] = [];
    const railTransforms: InstanceTransform[] = [];

    for (let index = 0; index < count; index += 1) {
      const z = 2 - index * (13 + this.random() * 7);
      const y = 20 + (index % 5) * 7 + this.random() * 7;
      const span = 42 + this.random() * 28;
      deckTransforms.push({
        position: new THREE.Vector3(0, y, z),
        scale: new THREE.Vector3(span, 0.32, 1.15),
        rotation: new THREE.Quaternion(),
        color: new THREE.Color(0x171e22)
      });
      railTransforms.push({
        position: new THREE.Vector3(0, y + 0.55, z + 0.58),
        scale: new THREE.Vector3(span * 0.94, 0.07, 0.08),
        rotation: new THREE.Quaternion(),
        color: new THREE.Color(index % 3 === 0 ? SIGNAL : CYAN)
      });
    }

    this.addStaticInstances(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.58, vertexColors: true }),
      deckTransforms
    );
    this.addStaticInstances(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.68 }),
      railTransforms
    );
  }

  private addUtilityCables(): void {
    const positions: number[] = [];
    const cableCount = this.quality.mobile ? 12 : 24;
    for (let cable = 0; cable < cableCount; cable += 1) {
      const z = -8 - cable * (7 + this.random() * 4.5);
      const width = 38 + this.random() * 34;
      const y = 33 + this.random() * 54;
      const sag = 3 + this.random() * 9;
      const start = new THREE.Vector3(-width, y, z);
      const control = new THREE.Vector3(0, y - sag, z - this.random() * 4);
      const end = new THREE.Vector3(width, y + (this.random() - 0.5) * 4, z - this.random() * 4);
      let previous = start;
      for (let step = 1; step <= 10; step += 1) {
        const t = step / 10;
        const inverse = 1 - t;
        const point = new THREE.Vector3(
          inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
          inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
          inverse * inverse * start.z + 2 * inverse * t * control.z + t * t * end.z
        );
        positions.push(previous.x, previous.y, previous.z, point.x, point.y, point.z);
        previous = point;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0x344249, transparent: true, opacity: 0.42 });
    this.scene.add(new THREE.LineSegments(geometry, material));
  }

  private addHolograms(): void {
    const labels = [
      `GRID//${this.channelCode}`,
      "WPM EXCHANGE",
      "SECTOR 09",
      "NO SUN",
      "TRANSIT//LIVE",
      "RACE LINE",
      "SIGNAL LOST",
      "KEYRUSH"
    ];
    const atlas = this.createSignAtlas(labels);
    const placements = [
      { x: -16, y: 42, z: -24, r: 0.16, w: 13 },
      { x: 18, y: 54, z: -44, r: -0.18, w: 12 },
      { x: -24, y: 65, z: -68, r: 0.26, w: 13 },
      { x: 20, y: 36, z: -92, r: -0.24, w: 10 },
      { x: -16, y: 72, z: -118, r: 0.12, w: 12 },
      { x: 22, y: 58, z: -145, r: -0.2, w: 10 },
      { x: -28, y: 38, z: -170, r: 0.22, w: 9 },
      { x: 14, y: 86, z: -198, r: -0.1, w: 13 }
    ].slice(0, this.quality.signs);

    placements.forEach((placement, index) => {
      const geometry = new THREE.PlaneGeometry(1, 1);
      applyAtlasUv(geometry, index, 4, 2);
      const material = new THREE.MeshBasicMaterial({
        map: atlas,
        transparent: true,
        opacity: 0.58,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: index % 3 === 0 ? SIGNAL : CYAN
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(placement.x, placement.y, placement.z);
      mesh.scale.set(placement.w, placement.w * 0.34, 1);
      mesh.rotation.y = placement.r;
      mesh.renderOrder = 2;
      material.toneMapped = false;
      this.holograms.push({
        mesh,
        baseY: placement.y,
        baseWidth: placement.w,
        phase: index * 1.74,
        baseOpacity: 0.56 + (index % 3) * 0.08
      });
      this.scene.add(mesh);
    });
  }

  private createSignAtlas(labels: string[]): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) return new THREE.CanvasTexture(canvas);

    const tileWidth = canvas.width / 4;
    const tileHeight = canvas.height / 2;
    context.clearRect(0, 0, canvas.width, canvas.height);

    labels.slice(0, 8).forEach((label, index) => {
      const x = (index % 4) * tileWidth;
      const y = Math.floor(index / 4) * tileHeight;
      const accent = index % 3 === 0 ? "255,77,61" : "116,234,220";
      context.fillStyle = "rgba(2,5,7,0.88)";
      context.fillRect(x + 8, y + 14, tileWidth - 16, tileHeight - 28);
      context.strokeStyle = `rgba(${accent},0.85)`;
      context.lineWidth = 3;
      context.strokeRect(x + 10, y + 16, tileWidth - 20, tileHeight - 32);
      context.fillStyle = `rgba(${accent},0.18)`;
      context.fillRect(x + 14, y + 20, tileWidth - 28, 18);
      context.fillStyle = `rgba(${accent},0.96)`;
      context.font = `800 ${label.length > 12 ? 25 : 31}px monospace`;
      context.fillText(label.slice(0, 15), x + 22, y + 118);
      context.font = "700 10px monospace";
      context.fillStyle = "rgba(220,230,226,0.66)";
      context.fillText(`DIST ${String(index + 3).padStart(2, "0")} // ${this.channelCode}`, x + 22, y + 58);
      context.fillText("AUTHORIZED SIGNAL", x + 22, y + 184);
      for (let line = 0; line < tileHeight; line += 6) {
        context.fillStyle = line % 12 === 0 ? "rgba(230,240,236,0.055)" : "rgba(0,0,0,0.08)";
        context.fillRect(x + 10, y + line, tileWidth - 20, 1);
      }
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    return texture;
  }

  private addTraffic(): void {
    const count = this.quality.traffic;
    const bodyGeometry = new THREE.BoxGeometry(1, 1, 1);
    const coreGeometry = new THREE.BoxGeometry(1, 1, 1);
    const trailGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.trafficBody = new THREE.InstancedMesh(
      bodyGeometry,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0.74, vertexColors: true }),
      count
    );
    this.trafficCore = new THREE.InstancedMesh(
      coreGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.92 }),
      count
    );
    this.trafficTrail = new THREE.InstancedMesh(
      trailGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      }),
      count
    );

    for (let index = 0; index < count; index += 1) {
      const axis: "x" | "z" = index % 5 === 0 ? "x" : "z";
      const direction: 1 | -1 = index % 2 === 0 ? 1 : -1;
      const color = new THREE.Color(index % 4 === 0 ? SIGNAL : CYAN);
      this.traffic.push({
        axis,
        base: this.random() * (WORLD_MAX - WORLD_MIN),
        lane: axis === "z" ? (this.random() - 0.5) * 29 : -36 - this.random() * 120,
        altitude: 11 + this.random() * 48,
        speed: 7 + this.random() * 19,
        phase: this.random() * Math.PI * 2,
        direction,
        color
      });
      this.trafficBody.setColorAt(index, new THREE.Color(0x293237));
      this.trafficCore.setColorAt(index, color);
      this.trafficTrail.setColorAt(index, color);
    }
    this.trafficBody.instanceColor!.needsUpdate = true;
    this.trafficCore.instanceColor!.needsUpdate = true;
    this.trafficTrail.instanceColor!.needsUpdate = true;
    this.trafficBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trafficCore.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trafficTrail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.trafficTrail, this.trafficBody, this.trafficCore);
  }

  private addLobbyBeacon(): void {
    const root = new THREE.Group();
    root.position.set(0, 0, -20);

    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(6.8, 8.2, 0.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x11181b, roughness: 0.38, metalness: 0.72 })
    );
    platform.rotation.y = Math.PI * 0.125;

    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.34, 11, 6),
      new THREE.MeshStandardMaterial({ color: 0x4e5b60, roughness: 0.42, metalness: 0.68 })
    );
    mast.position.y = 5.5;

    const rings: LobbyBeacon["rings"] = [];
    [2.4, 4.2, 6.4].forEach((radius, index) => {
      const material = new THREE.MeshBasicMaterial({
        color: index === 1 ? CYAN : SIGNAL,
        transparent: true,
        opacity: 0.68 - index * 0.1,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035, 5, 72), material);
      ring.position.y = 11 + index * 1.6;
      ring.rotation.x = Math.PI * (0.46 + index * 0.08);
      rings.push(ring);
      root.add(ring);
    });

    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.72, 0),
      new THREE.MeshBasicMaterial({ color: SIGNAL, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
    );
    core.position.y = 12.6;

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 2.4, 50, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: SIGNAL,
        transparent: true,
        opacity: 0.045,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    beam.position.y = 31;

    const light = new THREE.PointLight(SIGNAL, 14, 64, 1.8);
    light.position.y = 12;
    root.add(platform, mast, core, beam, light);
    this.scene.add(root);
    this.beacon = { root, rings, core, beam, light };
  }

  private addRain(): void {
    const count = this.quality.rain;
    const positions = new Float32Array(count * 6);
    for (let index = 0; index < count; index += 1) {
      this.rainDrops.push({
        x: (this.random() - 0.5) * 150,
        z: 42 - this.random() * 300,
        baseY: this.random() * 95,
        speed: 18 + this.random() * 34,
        length: 0.8 + this.random() * 2.8,
        drift: (this.random() - 0.5) * 0.55
      });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0x8cc8c6,
      transparent: true,
      opacity: this.quality.mobile ? 0.18 : 0.24,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.rainPositions = positions;
    this.rain = new THREE.LineSegments(geometry, material);
    this.scene.add(this.rain);
  }

  private addFogBanks(): void {
    const texture = this.createFogTexture();
    for (let index = 0; index < this.quality.fogBanks; index += 1) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: index % 3 === 0 ? 0x243136 : 0x121d22,
        transparent: true,
        opacity: 0.09,
        depthWrite: false
      });
      const sprite = new THREE.Sprite(material);
      const baseX = (this.random() - 0.5) * 90;
      const baseY = 8 + this.random() * 54;
      sprite.position.set(baseX, baseY, -34 - index * 34 - this.random() * 20);
      sprite.scale.set(58 + this.random() * 74, 14 + this.random() * 18, 1);
      this.fogBanks.push({
        sprite,
        baseX,
        baseY,
        speed: 0.45 + this.random() * 0.75,
        phase: this.random() * Math.PI * 2
      });
      this.scene.add(sprite);
    }
  }

  private createFogTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) return new THREE.CanvasTexture(canvas);
    const gradient = context.createRadialGradient(128, 48, 4, 128, 48, 124);
    gradient.addColorStop(0, "rgba(205,225,225,0.32)");
    gradient.addColorStop(0.44, "rgba(116,145,148,0.13)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  private animate = (): void => {
    if (this.disposed || this.suspended) return;
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;
    this.activity = THREE.MathUtils.lerp(this.activity, this.activityTarget, Math.min(1, delta * 1.7));
    this.joinSurge = Math.max(0, this.joinSurge - delta * 0.58);

    if (this.facadeMaterial) this.facadeMaterial.uniforms.uTime.value = elapsed;
    this.animateTraffic(elapsed);
    this.animateRain(elapsed);
    this.animateBeacon(elapsed);
    this.animateHolograms(elapsed);
    this.animateFog(elapsed);
    this.animateStorm(elapsed);
    this.animateCamera(elapsed, delta);

    this.renderer.render(this.scene, this.camera);
    if (!this.reducedMotion) this.frame = requestAnimationFrame(this.animate);
  };

  private animateTraffic(elapsed: number): void {
    const body = this.trafficBody;
    const core = this.trafficCore;
    const trail = this.trafficTrail;
    if (!body || !core || !trail) return;
    const range = WORLD_MAX - WORLD_MIN;

    this.traffic.forEach((vehicle, index) => {
      const travel = (vehicle.base + elapsed * vehicle.speed) % range;
      let x: number;
      let z: number;
      let rotationY: number;
      let trailX = 0;
      let trailZ = 0;

      if (vehicle.axis === "z") {
        z = vehicle.direction > 0 ? WORLD_MIN + travel : WORLD_MAX - travel;
        x = vehicle.lane + Math.sin(elapsed * 0.42 + vehicle.phase) * 1.4;
        rotationY = vehicle.direction > 0 ? 0 : Math.PI;
        trailZ = -vehicle.direction * 2.4;
      } else {
        const crossRange = 142;
        const crossTravel = (vehicle.base + elapsed * vehicle.speed * 0.72) % crossRange;
        x = vehicle.direction > 0 ? -71 + crossTravel : 71 - crossTravel;
        z = vehicle.lane;
        rotationY = vehicle.direction > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
        trailX = -vehicle.direction * 2.4;
      }
      const y = vehicle.altitude + Math.sin(elapsed * 0.8 + vehicle.phase) * 0.34;
      this.scratchQuaternion.setFromAxisAngle(Y_AXIS, rotationY);

      this.setDynamicInstance(body, index, x, y, z, 0.72, 0.16, 1.35, this.scratchQuaternion);
      this.setDynamicInstance(core, index, x, y + 0.06, z, 0.46, 0.12, 0.62, this.scratchQuaternion);
      this.setDynamicInstance(
        trail,
        index,
        x + trailX,
        y,
        z + trailZ,
        0.13,
        0.045,
        3.3 + vehicle.speed * 0.07,
        this.scratchQuaternion
      );
    });
    body.instanceMatrix.needsUpdate = true;
    core.instanceMatrix.needsUpdate = true;
    trail.instanceMatrix.needsUpdate = true;
  }

  private setDynamicInstance(
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
    rotation: THREE.Quaternion
  ): void {
    this.scratchMatrix.compose(
      this.scratchPosition.set(x, y, z),
      rotation,
      this.scratchScale.set(scaleX, scaleY, scaleZ)
    );
    mesh.setMatrixAt(index, this.scratchMatrix);
  }

  private animateRain(elapsed: number): void {
    const rain = this.rain;
    const positions = this.rainPositions;
    if (!rain || !positions) return;
    const verticalRange = 104;
    this.rainDrops.forEach((drop, index) => {
      const y = 100 - ((drop.baseY + elapsed * drop.speed) % verticalRange);
      const x = drop.x + Math.sin(elapsed * 0.18 + index) * drop.drift;
      const offset = index * 6;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = drop.z;
      positions[offset + 3] = x - 0.22 - drop.drift * 0.2;
      positions[offset + 4] = y + drop.length;
      positions[offset + 5] = drop.z - 0.18;
    });
    rain.geometry.attributes.position.needsUpdate = true;
  }

  private animateBeacon(elapsed: number): void {
    if (!this.beacon) return;
    const pulse = 0.5 + Math.sin(elapsed * (2.1 + this.activity * 1.4)) * 0.5;
    const charge = this.activity + this.joinSurge * 0.55;
    this.beacon.root.rotation.y = elapsed * (0.075 + this.activity * 0.055);
    this.beacon.rings.forEach((ring, index) => {
      const direction = index % 2 === 0 ? 1 : -1;
      ring.rotation.z = elapsed * direction * (0.12 + this.activity * 0.28) + index;
      const scale = 1 + Math.sin(elapsed * (1.2 + index * 0.16) + index) * (0.045 + charge * 0.018);
      ring.scale.setScalar(scale);
      ring.material.opacity = 0.3 + charge * 0.16 + pulse * (0.24 - index * 0.035);
    });
    this.beacon.core.rotation.x = elapsed * 0.62;
    this.beacon.core.rotation.y = elapsed * 0.86;
    this.beacon.core.scale.setScalar(0.78 + charge * 0.18 + pulse * 0.34);
    this.beacon.beam.material.opacity = 0.02 + charge * 0.035 + pulse * 0.035;
    this.beacon.light.intensity = 7 + charge * 12 + pulse * 11;
  }

  private animateHolograms(elapsed: number): void {
    this.holograms.forEach((hologram, index) => {
      hologram.mesh.position.y = hologram.baseY + Math.sin(elapsed * 0.42 + hologram.phase) * 0.28;
      const glitch = Math.sin(elapsed * 17 + hologram.phase) > 0.965 ? 0.28 : 0;
      hologram.mesh.material.opacity = hologram.baseOpacity + Math.sin(elapsed * 1.1 + hologram.phase) * 0.1 + glitch;
      hologram.mesh.scale.x = hologram.baseWidth * (glitch > 0 ? 1.045 : 1);
      if (index % 2 === 0) hologram.mesh.rotation.z = Math.sin(elapsed * 0.15 + index) * 0.008;
    });
  }

  private animateFog(elapsed: number): void {
    this.fogBanks.forEach((bank) => {
      bank.sprite.position.x = bank.baseX + Math.sin(elapsed * 0.12 + bank.phase) * 8 + elapsed * bank.speed % 16;
      bank.sprite.position.y = bank.baseY + Math.sin(elapsed * 0.16 + bank.phase) * 1.5;
      bank.sprite.material.opacity = 0.055 + Math.sin(elapsed * 0.2 + bank.phase) * 0.025;
    });
  }

  private animateStorm(elapsed: number): void {
    if (!this.stormLight) return;
    const broadFlash = Math.pow(Math.max(0, Math.sin(elapsed * 0.23 + 1.8)), 96);
    const echo = Math.pow(Math.max(0, Math.sin(elapsed * 0.47 + 0.4)), 180);
    this.stormLight.intensity = broadFlash * 2.8 + echo * 1.2;
  }

  private animateCamera(elapsed: number, delta: number): void {
    this.pointer.lerp(this.pointerTarget, Math.min(1, delta * 2.8));
    const driftX = this.reducedMotion ? 0 : Math.sin(elapsed * 0.12) * 2.2;
    const driftY = this.reducedMotion ? 0 : Math.sin(elapsed * 0.09) * 0.75;
    this.camera.position.set(
      driftX + this.pointer.x * 4.2,
      this.baseCameraY + driftY - this.pointer.y * 1.8,
      this.baseCameraZ
    );
    this.camera.lookAt(
      this.pointer.x * 5.8 + Math.sin(elapsed * 0.17) * 1.4,
      this.targetCameraY - this.pointer.y * 2.2,
      -58
    );
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.reducedMotion) return;
    this.pointerTarget.set(
      event.clientX / Math.max(1, window.innerWidth) * 2 - 1,
      event.clientY / Math.max(1, window.innerHeight) * 2 - 1
    );
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.suspended = true;
      cancelAnimationFrame(this.frame);
      this.clock.stop();
      return;
    }
    if (this.disposed) return;
    this.suspended = false;
    this.clock.start();
    this.animate();
  };

  private resize = (): void => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const aspect = width / height;
    const portrait = aspect < 0.95;
    this.camera.aspect = aspect;
    this.camera.fov = portrait ? 61 : aspect < 1.35 ? 55 : 50;
    this.baseCameraY = portrait ? 23 : 18;
    this.baseCameraZ = portrait ? 68 : aspect < 1.35 ? 59 : 52;
    this.targetCameraY = portrait ? 31 : 23;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    if (this.reducedMotion) {
      this.animateCamera(0, 1);
      this.renderer.render(this.scene, this.camera);
    }
  };

  private disposeSceneResources(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite)) return;
      if ("geometry" in object && object.geometry instanceof THREE.BufferGeometry) geometries.add(object.geometry);
      const objectMaterial = "material" in object ? object.material : null;
      const materialList = Array.isArray(objectMaterial) ? objectMaterial : objectMaterial ? [objectMaterial] : [];
      materialList.forEach((material) => {
        if (!(material instanceof THREE.Material)) return;
        materials.add(material);
        Object.values(material).forEach((value) => {
          if (value instanceof THREE.Texture) textures.add(value);
        });
      });
    });
    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material.dispose());
    geometries.forEach((geometry) => geometry.dispose());
  }
}

function chooseQuality(): SceneQuality {
  const mobile = window.matchMedia("(max-width: 720px), (pointer: coarse)").matches;
  const medium = !mobile && window.innerWidth < 1180;
  const deviceRatio = window.devicePixelRatio || 1;
  if (mobile) {
    return { mobile: true, towers: 96, traffic: 20, rain: 220, signs: 5, fogBanks: 4, pixelRatio: Math.min(1, deviceRatio) };
  }
  if (medium) {
    return { mobile: false, towers: 138, traffic: 30, rain: 340, signs: 7, fogBanks: 5, pixelRatio: Math.min(1.05, deviceRatio) };
  }
  return { mobile: false, towers: 184, traffic: 38, rain: 460, signs: 8, fogBanks: 6, pixelRatio: Math.min(1.2, deviceRatio) };
}

function applyAtlasUv(geometry: THREE.PlaneGeometry, index: number, columns: number, rows: number): void {
  const uv = geometry.attributes.uv;
  const column = index % columns;
  const row = rows - 1 - Math.floor(index / columns);
  for (let vertex = 0; vertex < uv.count; vertex += 1) {
    const sourceU = uv.getX(vertex);
    const sourceV = uv.getY(vertex);
    uv.setXY(vertex, (column + sourceU) / columns, (row + sourceV) / rows);
  }
  uv.needsUpdate = true;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
