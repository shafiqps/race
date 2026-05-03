import * as THREE from "three";

interface Building {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  windows: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  phase: number;
}

interface TransitLight {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  lane: number;
  speed: number;
  phase: number;
}

const HOLO_RAIN = 180;

export class LobbyWorldScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 320);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  private readonly clock = new THREE.Clock();
  private readonly buildings: Building[] = [];
  private readonly transitLights: TransitLight[] = [];
  private holoRain: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
  private holoRainPositions: Float32Array | null = null;
  private frame = 0;
  private disposed = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x050604);
    this.renderer.domElement.className = "lobby-canvas";
    this.container.append(this.renderer.domElement);

    this.camera.position.set(0, 14, 42);
    this.camera.lookAt(0, 16, -34);

    this.buildWorld();
    this.resize();
    window.addEventListener("resize", this.resize);
    this.animate();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.resize);
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  private buildWorld(): void {
    this.scene.fog = new THREE.Fog(0x050604, 46, 210);
    this.scene.add(new THREE.HemisphereLight(0xd8d1bd, 0x080a09, 0.85));

    const red = new THREE.PointLight(0xff3a2f, 4.4, 92);
    red.position.set(-16, 22, 8);
    this.scene.add(red);

    const cyan = new THREE.PointLight(0x75f4ff, 3.2, 110);
    cyan.position.set(18, 18, -22);
    this.scene.add(cyan);

    const deck = new THREE.Mesh(
      new THREE.CylinderGeometry(28, 32, 0.55, 8),
      new THREE.MeshStandardMaterial({ color: 0x090b09, roughness: 0.82, metalness: 0.26 })
    );
    deck.position.set(0, -0.22, 0);
    deck.rotation.y = Math.PI * 0.125;
    this.scene.add(deck);

    const grid = new THREE.GridHelper(92, 46, 0x75f4ff, 0x222923);
    grid.position.set(0, 0.04, -10);
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.2;
    });
    this.scene.add(grid);

    this.addBuildings();
    this.addSkyBridges();
    this.addTransitLights();
    this.addLobbyBeacon();
    this.addHoloRain();
  }

  private addHoloRain(): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(HOLO_RAIN * 3);
    for (let i = 0; i < HOLO_RAIN; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 82;
      positions[i * 3 + 1] = 2 + Math.random() * 48;
      positions[i * 3 + 2] = 26 - Math.random() * 130;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0x75f4ff,
      size: 0.06,
      transparent: true,
      opacity: 0.44,
      depthWrite: false
    });
    this.holoRainPositions = positions;
    this.holoRain = new THREE.Points(geometry, material);
    this.scene.add(this.holoRain);
  }

  private addBuildings(): void {
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x0d100f, roughness: 0.68, metalness: 0.34 });
    const windowGeometry = new THREE.PlaneGeometry(1, 1);

    for (let i = 0; i < 42; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const depthBand = Math.floor(i / 2);
      const width = 3.8 + (i % 5) * 0.8;
      const height = 28 + (i % 8) * 6 + depthBand * 1.1;
      const depth = 3.4 + (i % 4) * 0.7;
      const x = side * (22 + (i % 5) * 5.8);
      const z = 18 - depthBand * 8.6;
      const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), bodyMaterial.clone());
      building.position.set(x, height / 2, z);

      const windows = new THREE.Mesh(
        windowGeometry,
        new THREE.MeshBasicMaterial({
          map: this.createWindowTexture(i),
          transparent: true,
          opacity: 0.68,
          side: THREE.DoubleSide
        })
      );
      windows.scale.set(width * 0.92, height * 0.88, 1);
      windows.position.set(x - side * (width / 2 + 0.015), height / 2, z + depth * 0.18);
      windows.rotation.y = side * Math.PI * 0.5;

      this.buildings.push({ mesh: building, windows, phase: i * 0.41 });
      this.scene.add(building, windows);
    }
  }

  private addSkyBridges(): void {
    const bridgeMaterial = new THREE.MeshBasicMaterial({ color: 0x75f4ff, transparent: true, opacity: 0.16 });
    const railMaterial = new THREE.MeshBasicMaterial({ color: 0xff3a2f, transparent: true, opacity: 0.36 });

    for (let i = 0; i < 8; i += 1) {
      const z = 4 - i * 10;
      const y = 18 + (i % 4) * 5;
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(42 + (i % 3) * 8, 0.08, 0.5), bridgeMaterial.clone());
      const rail = new THREE.Mesh(new THREE.BoxGeometry(40 + (i % 3) * 8, 0.05, 0.05), railMaterial.clone());
      bridge.position.set(0, y, z);
      rail.position.set(0, y + 0.38, z + 0.28);
      this.scene.add(bridge, rail);
    }
  }

  private createWindowTexture(seed: number): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) return new THREE.CanvasTexture(canvas);

    context.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 10; y < canvas.height - 10; y += 13) {
      for (let x = 8; x < canvas.width - 8; x += 14) {
        const lit = (x * 7 + y * 3 + seed * 19) % 11 < 5;
        if (!lit) continue;
        context.fillStyle = (x + seed) % 4 === 0 ? "rgba(255, 58, 47, 0.82)" : "rgba(117, 244, 255, 0.68)";
        context.fillRect(x, y, 5, 2);
      }
    }
    for (let y = 0; y < canvas.height; y += 6) {
      context.fillStyle = "rgba(216, 209, 189, 0.05)";
      context.fillRect(0, y, canvas.width, 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
  }

  private addTransitLights(): void {
    for (let i = 0; i < 18; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? 0xff3a2f : 0x75f4ff,
        transparent: true,
        opacity: 0.66
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.035, 0.035), material);
      const lane = (i % 6) - 2.5;
      mesh.position.set(lane * 8, 14 + (i % 6) * 3.1, 24 - i * 5.4);
      this.transitLights.push({ mesh, lane, speed: 0.18 + (i % 4) * 0.035, phase: i * 0.7 });
      this.scene.add(mesh);
    }
  }

  private addLobbyBeacon(): void {
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xff3a2f, transparent: true, opacity: 0.82 });
    const mastMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d1bd, roughness: 0.64, metalness: 0.34 });
    const root = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.18, 8, 0.18), mastMaterial);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.03, 6, 64), ringMaterial);
    const ringTwo = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.025, 6, 64), ringMaterial.clone());
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.8, 0.16, 8),
      new THREE.MeshStandardMaterial({ color: 0x0f1210, roughness: 0.72, metalness: 0.42 })
    );
    platform.rotation.y = Math.PI * 0.125;
    mast.position.y = 4;
    ring.position.y = 8.4;
    ringTwo.position.y = 8.4;
    ring.rotation.x = Math.PI * 0.5;
    ringTwo.rotation.x = Math.PI * 0.5;
    root.position.set(0, 0, -8);
    root.add(platform, mast, ring, ringTwo);
    this.scene.add(root);
  }

  private animate = (): void => {
    if (this.disposed) return;
    const elapsed = this.clock.getElapsedTime();

    this.buildings.forEach((building, index) => {
      building.windows.material.opacity =
        0.42 + Math.sin(elapsed * 1.3 + building.phase) * 0.16 + (Math.sin(elapsed * 13 + index) > 0.94 ? 0.24 : 0);
      building.mesh.position.y += Math.sin(elapsed * 0.5 + building.phase) * 0.0015;
    });

    this.transitLights.forEach((light) => {
      light.mesh.position.z -= light.speed;
      if (light.mesh.position.z < -88) light.mesh.position.z = 24;
      light.mesh.position.x = light.lane * 7 + Math.sin(elapsed * 0.9 + light.phase) * 1.4;
      light.mesh.material.opacity = 0.38 + Math.sin(elapsed * 4 + light.phase) * 0.2;
    });

    this.animateHoloRain(elapsed);

    this.camera.position.x = Math.sin(elapsed * 0.16) * 1.8;
    this.camera.position.y = 14 + Math.sin(elapsed * 0.11) * 0.6;
    this.camera.lookAt(Math.sin(elapsed * 0.22) * 2, 16, -34);
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  };

  private animateHoloRain(elapsed: number): void {
    if (!this.holoRain || !this.holoRainPositions) return;
    for (let i = 0; i < HOLO_RAIN; i += 1) {
      const y = i * 3 + 1;
      const z = i * 3 + 2;
      this.holoRainPositions[y] -= 0.12 + (i % 6) * 0.018;
      this.holoRainPositions[z] += 0.025;
      if (this.holoRainPositions[y] < 0.4) {
        this.holoRainPositions[i * 3] = (Math.random() - 0.5) * 82;
        this.holoRainPositions[y] = 42 + Math.random() * 20;
        this.holoRainPositions[z] = 26 - Math.random() * 130;
      }
    }
    this.holoRain.geometry.attributes.position.needsUpdate = true;
    this.holoRain.material.opacity = 0.34 + Math.sin(elapsed * 1.8) * 0.08;
  }

  private resize = (): void => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };
}
