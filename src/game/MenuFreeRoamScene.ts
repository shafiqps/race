import * as THREE from "three";
import { animateHoverRobot, createHoverRobot } from "./HoverRobot";
import { CyberpunkDitherPipeline } from "./CyberpunkDitherPipeline";

const TRACK_LENGTH = 70;
const GROUND_Y = 0;
const JUMP_VELOCITY = 0.34;
const GRAVITY = 0.018;
const MOVE_ACCELERATION = 0.024;
const MOVE_FRICTION = 0.86;
const MAX_MOVE_SPEED = 0.22;
const DATA_MOTES = 120;

interface DataPanel {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  baseX: number;
  baseY: number;
  phase: number;
  drift: number;
}

interface SignalNode {
  root: THREE.Group;
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  phase: number;
}

interface CityBuilding {
  windows: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  phase: number;
}

export class MenuFreeRoamScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 240);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  private readonly dither: CyberpunkDitherPipeline;
  private readonly keys = new Set<string>();
  private readonly robot = createHoverRobot();
  private readonly character = this.robot.root;
  private readonly clock = new THREE.Clock();
  private readonly cameraPosition = new THREE.Vector3(0, 4.8, 15);
  private readonly cameraLook = new THREE.Vector3(0, 1.4, 0);
  private readonly horizontalVelocity = new THREE.Vector3();
  private readonly scanPlanes: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly dataPanels: DataPanel[] = [];
  private readonly signalNodes: SignalNode[] = [];
  private readonly cityBuildings: CityBuilding[] = [];
  private dataMotes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
  private dataMotePositions: Float32Array | null = null;
  private grid: THREE.GridHelper | null = null;
  private frame = 0;
  private disposed = false;
  private dragging = false;
  private yaw = 0;
  private pitch = -0.18;
  private verticalVelocity = 0;
  private stride = 0;
  private landingPulse = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x070806);
    this.renderer.shadowMap.enabled = true;
    this.dither = new CyberpunkDitherPipeline(this.renderer, this.scene, this.camera);
    this.renderer.domElement.className = "menu-canvas";
    this.container.append(this.renderer.domElement);

    this.character.position.set(0, 0, 5.4);
    this.buildWorld();
    this.resize();

    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointermove", this.onPointerMove);
    this.animate();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointermove", this.onPointerMove);
    this.dither.dispose();
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  private buildWorld(): void {
    this.scene.fog = new THREE.Fog(0x070806, 30, 112);
    this.scene.add(new THREE.HemisphereLight(0xe9e0c8, 0x101513, 1.45));

    const sun = new THREE.DirectionalLight(0xff3a2f, 2.2);
    sun.position.set(-18, 26, 14);
    sun.castShadow = true;
    this.scene.add(sun);

    const cyan = new THREE.PointLight(0x75f4ff, 2.8, 44);
    cyan.position.set(8, 5, -16);
    this.scene.add(cyan);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 150),
      new THREE.MeshStandardMaterial({ color: 0x0b0d0b, roughness: 1, metalness: 0.16 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -24;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const track = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.32, TRACK_LENGTH),
      new THREE.MeshStandardMaterial({ color: 0x151714, roughness: 0.76, metalness: 0.16 })
    );
    track.position.set(0, 0, -TRACK_LENGTH / 2);
    track.receiveShadow = true;
    this.scene.add(track);

    for (let lane = -3; lane <= 3; lane += 1) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(lane === 0 ? 0.05 : 0.07, 0.05, TRACK_LENGTH - 4),
        new THREE.MeshStandardMaterial({
          color: lane === 0 ? 0xff3a2f : 0xd8d1bd,
          emissive: lane === 0 ? 0x4a0805 : 0x11100c,
          roughness: 0.75
        })
      );
      stripe.position.set(lane * 3, 0.22, -TRACK_LENGTH / 2);
      this.scene.add(stripe);
    }

    this.scene.add(this.character);

    const finish = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.08, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x75f4ff, emissive: 0x12383c, roughness: 0.5 })
    );
    finish.position.set(0, 0.34, -57);
    this.scene.add(finish);

    const grid = new THREE.GridHelper(100, 50, 0x75f4ff, 0x222923);
    grid.position.y = 0.03;
    grid.position.z = -24;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.42;
    });
    this.grid = grid;
    this.scene.add(grid);

    const pylonMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d1bd, roughness: 0.84, metalness: 0.28 });
    const redMaterial = new THREE.MeshStandardMaterial({ color: 0xff3a2f, emissive: 0x4a0805, roughness: 0.62 });
    const cyanMaterial = new THREE.MeshBasicMaterial({ color: 0x75f4ff, transparent: true, opacity: 0.4 });
    for (let index = 0; index < 26; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const x = side * (15 + (index % 4) * 0.8);
      const z = 7 - index * 4.2;
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.18, 5.8, 0.18), pylonMaterial);
      const marker = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.48), redMaterial);
      pylon.position.set(x, 2.9, z);
      marker.position.set(x - side * 1.1, 4.55, z);
      pylon.castShadow = true;
      marker.castShadow = true;
      this.scene.add(pylon, marker);

      if (index % 3 === 0) {
        const scan = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.4, 1, 1), cyanMaterial.clone());
        scan.position.set(x - side * 1.4, 2.6, z - 1.2);
        scan.rotation.y = side * Math.PI * 0.5;
        this.scanPlanes.push(scan);
        this.scene.add(scan);
      }
    }

    this.addSignalNodes();
    this.addDataPanels();
    this.addCitySkyline();
    this.addDataMotes();
  }

  private addDataMotes(): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(DATA_MOTES * 3);
    for (let i = 0; i < DATA_MOTES; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 46;
      positions[i * 3 + 1] = 0.4 + Math.random() * 8.5;
      positions[i * 3 + 2] = 12 - Math.random() * 78;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xd8d1bd,
      size: 0.055,
      transparent: true,
      opacity: 0.38,
      depthWrite: false
    });
    this.dataMotePositions = positions;
    this.dataMotes = new THREE.Points(geometry, material);
    this.scene.add(this.dataMotes);
  }

  private addCitySkyline(): void {
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x0b0d0c, roughness: 0.72, metalness: 0.32 });

    for (let i = 0; i < 30; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2);
      const width = 4 + (i % 5) * 0.7;
      const height = 20 + (i % 8) * 5 + row * 0.8;
      const depth = 4 + (i % 3) * 1.1;
      const x = side * (23 + (i % 4) * 6);
      const z = 12 - row * 6.4;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), bodyMaterial.clone());
      tower.position.set(x, height / 2 - 0.1, z);

      const windows = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 0.86, height * 0.84),
        new THREE.MeshBasicMaterial({
          map: this.createWindowTexture(i),
          transparent: true,
          opacity: 0.52,
          side: THREE.DoubleSide
        })
      );
      windows.position.set(x - side * (width / 2 + 0.02), height / 2, z + depth * 0.18);
      windows.rotation.y = side * Math.PI * 0.5;
      this.cityBuildings.push({ windows, phase: i * 0.37 });
      this.scene.add(tower, windows);
    }
  }

  private createWindowTexture(seed: number): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) return new THREE.CanvasTexture(canvas);

    context.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 8; y < canvas.height - 8; y += 14) {
      for (let x = 7; x < canvas.width - 7; x += 13) {
        if ((x * 5 + y * 11 + seed * 17) % 13 > 5) continue;
        context.fillStyle = (x + seed) % 5 === 0 ? "rgba(255, 58, 47, 0.78)" : "rgba(117, 244, 255, 0.56)";
        context.fillRect(x, y, 5, 2);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
  }

  private addSignalNodes(): void {
    const padMaterial = new THREE.MeshStandardMaterial({ color: 0x080a09, roughness: 0.58, metalness: 0.38 });
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xff3a2f, transparent: true, opacity: 0.8 });

    [
      { x: -4.4, z: 6.8, phase: 0 },
      { x: 4.4, z: 6.8, phase: 1.8 },
      { x: 0, z: 1.8, phase: 3.1 }
    ].forEach(({ x, z, phase }) => {
      const root = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.08, 6), padMaterial);
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.8, 0.14), padMaterial);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.025, 6, 42), ringMaterial.clone());
      pad.position.y = 0.08;
      mast.position.y = 0.96;
      ring.position.y = 1.96;
      ring.rotation.x = Math.PI * 0.5;
      root.position.set(x, 0.02, z);
      root.add(pad, mast, ring);
      this.signalNodes.push({ root, ring, phase });
      this.scene.add(root);
    });
  }

  private addDataPanels(): void {
    [
      { x: -7.6, y: 2.7, z: 4.2, rotation: 0.36, phase: 0.4, label: "OPEN" },
      { x: 7.4, y: 2.55, z: 3.2, rotation: -0.34, phase: 1.7, label: "JOIN" },
      { x: -8.2, y: 3.2, z: -8.8, rotation: 0.5, phase: 2.8, label: "SYNC" },
      { x: 8.5, y: 3.0, z: -13.6, rotation: -0.46, phase: 3.6, label: "VECTOR" }
    ].forEach((panel) => {
      const material = new THREE.MeshBasicMaterial({
        map: this.createDataPanelTexture(panel.label),
        transparent: true,
        opacity: 0.74,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.42), material);
      mesh.position.set(panel.x, panel.y, panel.z);
      mesh.rotation.y = panel.rotation;
      this.dataPanels.push({
        mesh,
        baseX: panel.x,
        baseY: panel.y,
        phase: panel.phase,
        drift: 0.14 + panel.phase * 0.01
      });
      this.scene.add(mesh);
    });
  }

  private createDataPanelTexture(label: string): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 112;
    const context = canvas.getContext("2d");
    if (!context) return new THREE.CanvasTexture(canvas);

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(7, 8, 6, 0.52)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(117, 244, 255, 0.82)";
    context.lineWidth = 2;
    context.strokeRect(8, 8, 240, 96);
    context.fillStyle = "rgba(255, 58, 47, 0.82)";
    context.fillRect(16, 18, 52, 4);
    context.fillRect(16, 88, 116, 3);
    context.fillStyle = "rgba(216, 209, 189, 0.88)";
    context.font = "700 28px monospace";
    context.fillText(label, 18, 62);
    context.font = "700 10px monospace";
    context.fillStyle = "rgba(117, 244, 255, 0.72)";
    context.fillText("SYS:03  1F  A9  00", 150, 30);
    context.fillText("SIGNAL READY", 150, 92);
    for (let y = 0; y < canvas.height; y += 5) {
      context.fillStyle = y % 10 === 0 ? "rgba(235, 231, 217, 0.08)" : "rgba(7, 8, 6, 0.16)";
      context.fillRect(0, y, canvas.width, 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
  }

  private animate = (): void => {
    if (this.disposed) return;
    const step = Math.min(this.clock.getDelta() * 60, 2);
    const elapsed = this.clock.elapsedTime;
    this.movePlayer(step);
    this.animateCharacter(step);
    this.animateWorld(elapsed, step);
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const speed = this.horizontalVelocity.length();
    const desiredCamera = this.character.position
      .clone()
      .add(forward.clone().multiplyScalar(-8.4 - speed * 5))
      .add(new THREE.Vector3(0, 4.2 + this.pitch * 2.4 + speed * 1.8, 0));
    const desiredLook = this.character.position
      .clone()
      .add(forward.clone().multiplyScalar(3.2 + speed * 2.4))
      .add(new THREE.Vector3(0, 1.45 + this.pitch * 1.5 + speed * 0.5, 0));
    this.cameraPosition.lerp(desiredCamera, 0.1);
    this.cameraLook.lerp(desiredLook, 0.14);
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraLook);
    this.dither.render(step / 60);
    this.frame = requestAnimationFrame(this.animate);
  };

  private movePlayer(step: number): void {
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const direction = new THREE.Vector3();

    if (!(document.activeElement instanceof HTMLInputElement)) {
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) direction.add(forward);
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) direction.sub(forward);
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) direction.add(right);
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) direction.sub(right);
    }

    if (direction.lengthSq() > 0) {
      direction.normalize();
      this.horizontalVelocity.add(direction.multiplyScalar(MOVE_ACCELERATION * step));
    } else {
      this.horizontalVelocity.multiplyScalar(Math.pow(MOVE_FRICTION, step));
    }

    if (this.horizontalVelocity.length() > MAX_MOVE_SPEED) {
      this.horizontalVelocity.setLength(MAX_MOVE_SPEED);
    }

    this.character.position.add(this.horizontalVelocity.clone().multiplyScalar(step));
    this.character.position.x = THREE.MathUtils.clamp(this.character.position.x, -9, 9);
    this.character.position.z = THREE.MathUtils.clamp(this.character.position.z, -54, 12);

    const wasGrounded = this.character.position.y === GROUND_Y;
    this.verticalVelocity -= GRAVITY * step;
    this.character.position.y += this.verticalVelocity * step;
    if (this.character.position.y <= GROUND_Y) {
      this.character.position.y = GROUND_Y;
      if (!wasGrounded && this.verticalVelocity < -0.08) this.landingPulse = 1;
      this.verticalVelocity = 0;
    }
  }

  private animateCharacter(step: number): void {
    const speed = this.horizontalVelocity.length();
    const speedRatio = speed / MAX_MOVE_SPEED;
    this.dither.setMotion(speedRatio);
    const grounded = this.character.position.y === GROUND_Y;
    this.stride += speed * step * 18;
    this.landingPulse = Math.max(0, this.landingPulse - 0.12 * step);
    animateHoverRobot(this.robot, this.clock.elapsedTime, speedRatio);

    if (speed > 0.01) {
      const targetYaw = Math.atan2(this.horizontalVelocity.x, -this.horizontalVelocity.z);
      this.character.rotation.y = THREE.MathUtils.lerp(this.character.rotation.y, targetYaw, 0.18 * step);
    }

    const bob = grounded ? Math.sin(this.stride) * speed * 0.18 : 0;
    const compression = this.landingPulse * 0.12;
    const stretch = grounded ? 0 : THREE.MathUtils.clamp(this.verticalVelocity * 0.16, -0.08, 0.1);
    this.character.scale.set(
      1 + compression * 0.7 - stretch * 0.35,
      1 - compression + stretch,
      1 + compression * 0.7 - stretch * 0.35
    );

    this.character.rotation.x = THREE.MathUtils.lerp(
      this.character.rotation.x,
      grounded ? bob * 0.16 : THREE.MathUtils.clamp(this.verticalVelocity * 0.28, -0.16, 0.18),
      0.16 * step
    );
    this.character.rotation.z = THREE.MathUtils.lerp(
      this.character.rotation.z,
      -this.horizontalVelocity.x * 0.75,
      0.14 * step
    );
  }

  private animateWorld(elapsed: number, step: number): void {
    if (this.grid) {
      this.grid.position.y = 0.03 + Math.sin(elapsed * 1.4) * 0.018;
      const materials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
      materials.forEach((material, index) => {
        material.opacity = 0.28 + Math.sin(elapsed * 1.7 + index * 0.8) * 0.12;
      });
    }

    this.scanPlanes.forEach((scan, index) => {
      const flicker = Math.sin(elapsed * 9.5 + index * 2.2) > 0.78 ? 0.34 : 0;
      scan.material.opacity = 0.24 + Math.sin(elapsed * 1.9 + index) * 0.1 + flicker;
      scan.position.y = 2.6 + Math.sin(elapsed * 0.9 + index) * 0.22;
      scan.scale.y = 0.72 + Math.sin(elapsed * 1.4 + index * 0.7) * 0.18;
    });

    this.dataPanels.forEach((panel, index) => {
      panel.mesh.position.y = panel.baseY + Math.sin(elapsed * 0.8 + panel.phase) * panel.drift;
      panel.mesh.position.x = panel.baseX + Math.sin(elapsed * 1.3 + panel.phase) * 0.08;
      panel.mesh.material.opacity =
        0.58 + Math.sin(elapsed * 1.2 + panel.phase) * 0.16 + (Math.sin(elapsed * 17 + index) > 0.94 ? 0.22 : 0);
      panel.mesh.scale.x = 1 + (Math.sin(elapsed * 23 + panel.phase) > 0.96 ? 0.035 : 0);
    });

    this.signalNodes.forEach((node) => {
      const distance = node.root.position.distanceTo(this.character.position);
      const proximity = THREE.MathUtils.clamp(1 - distance / 5, 0, 1);
      const pulse = 0.72 + Math.sin(elapsed * 3 + node.phase) * 0.14 + proximity * 0.34;
      node.ring.scale.setScalar(pulse);
      node.ring.rotation.z += (0.018 + proximity * 0.03) * step;
      node.ring.material.opacity = 0.42 + proximity * 0.44 + Math.sin(elapsed * 4 + node.phase) * 0.1;
    });

    this.cityBuildings.forEach((building, index) => {
      building.windows.material.opacity =
        0.36 + Math.sin(elapsed * 0.9 + building.phase) * 0.13 + (Math.sin(elapsed * 11 + index) > 0.95 ? 0.24 : 0);
    });

    this.animateDataMotes(elapsed, step);
  }

  private animateDataMotes(elapsed: number, step: number): void {
    if (!this.dataMotes || !this.dataMotePositions) return;
    for (let i = 0; i < DATA_MOTES; i += 1) {
      const x = i * 3;
      const y = x + 1;
      const z = x + 2;
      this.dataMotePositions[x] += Math.sin(elapsed * 0.7 + i) * 0.004 * step;
      this.dataMotePositions[y] += (0.006 + (i % 5) * 0.0015) * step;
      this.dataMotePositions[z] += (0.012 + (i % 7) * 0.001) * step;
      if (this.dataMotePositions[y] > 9.5 || this.dataMotePositions[z] > 14) {
        this.dataMotePositions[x] = (Math.random() - 0.5) * 46;
        this.dataMotePositions[y] = 0.3;
        this.dataMotePositions[z] = 12 - Math.random() * 78;
      }
    }
    this.dataMotes.geometry.attributes.position.needsUpdate = true;
    this.dataMotes.material.opacity = 0.28 + Math.sin(elapsed * 1.2) * 0.08;
  }

  private resize = (): void => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.dither.setSize(width, height);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Space" && !(document.activeElement instanceof HTMLInputElement)) {
      event.preventDefault();
      if (!event.repeat && this.character.position.y === GROUND_Y) {
        this.verticalVelocity = JUMP_VELOCITY;
        this.landingPulse = 0;
      }
    }
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private onPointerDown = (): void => {
    this.dragging = true;
  };

  private onPointerUp = (): void => {
    this.dragging = false;
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.yaw -= event.movementX * 0.004;
    this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.003, -0.58, 0.22);
  };
}
