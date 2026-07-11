import * as THREE from "three";

export interface HoverRobot {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  visor: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  eye: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  antenna: THREE.Group;
  fins: THREE.Group[];
  thrusters: THREE.Group[];
  thrusterFlames: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>[];
  hoverRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  trail: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
}

/** Builds K-0, a compact racing drone with a readable silhouette at gameplay distance. */
export function createHoverRobot(color: string | number = 0xff3a2f): HoverRobot {
  const root = new THREE.Group();
  root.name = "K-0 hover runner";

  const paintColor = new THREE.Color(color);
  const paint = new THREE.MeshStandardMaterial({ color: paintColor, roughness: 0.28, metalness: 0.72 });
  const paintDark = new THREE.MeshStandardMaterial({
    color: paintColor.clone().multiplyScalar(0.34),
    roughness: 0.34,
    metalness: 0.82
  });
  const graphite = new THREE.MeshStandardMaterial({ color: 0x090d11, roughness: 0.42, metalness: 0.78 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xa5afb2, roughness: 0.27, metalness: 0.92 });
  const cyan = new THREE.MeshStandardMaterial({
    color: 0x8af8ff,
    emissive: 0x159baa,
    emissiveIntensity: 1.8,
    roughness: 0.16,
    metalness: 0.28
  });
  const glow = new THREE.MeshBasicMaterial({
    color: 0x75f4ff,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const body = new THREE.Group();
  body.position.y = 1.42;
  const core = mesh(new THREE.CapsuleGeometry(0.48, 0.62, 7, 12), graphite);
  core.rotation.z = Math.PI / 2;
  core.scale.set(1, 1.05, 0.88);
  const chest = mesh(new THREE.BoxGeometry(0.78, 0.62, 0.5, 2, 2, 2), paint);
  chest.position.set(0, 0.08, -0.22);
  chest.rotation.x = -0.08;
  const chestInset = mesh(new THREE.BoxGeometry(0.38, 0.32, 0.035), graphite);
  chestInset.position.set(0, 0.08, -0.493);
  const reactor = mesh(new THREE.OctahedronGeometry(0.13, 0), cyan);
  reactor.position.set(0, 0.08, -0.53);
  reactor.rotation.z = Math.PI / 4;
  const spine = mesh(new THREE.BoxGeometry(0.24, 0.72, 0.18), steel);
  spine.position.set(0, 0.02, 0.38);
  body.add(core, chest, chestInset, reactor, spine);

  for (const side of [-1, 1]) {
    const rib = mesh(new THREE.BoxGeometry(0.12, 0.5, 0.54), paintDark);
    rib.position.set(side * 0.49, 0.02, 0);
    rib.rotation.z = side * -0.18;
    const bolt = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.035, 10), cyan);
    bolt.rotation.z = Math.PI / 2;
    bolt.position.set(side * 0.565, 0.07, -0.16);
    body.add(rib, bolt);
  }

  const neck = mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.2, 10), steel);
  neck.position.y = 0.58;
  body.add(neck);

  const head = new THREE.Group();
  head.position.y = 2.2;
  const helmet = mesh(new THREE.SphereGeometry(0.43, 18, 12), paint);
  helmet.scale.set(1.12, 0.86, 1);
  const jaw = mesh(new THREE.BoxGeometry(0.58, 0.2, 0.42), graphite);
  jaw.position.set(0, -0.23, -0.04);
  const visor = mesh(new THREE.BoxGeometry(0.68, 0.22, 0.075), cyan);
  visor.position.set(0, 0.02, -0.395);
  visor.rotation.x = -0.04;
  const eye = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.065), glow.clone());
  eye.position.set(0.16, 0.02, -0.437);
  const brow = mesh(new THREE.BoxGeometry(0.74, 0.065, 0.12), graphite);
  brow.position.set(0, 0.17, -0.33);
  brow.rotation.x = -0.17;
  head.add(helmet, jaw, visor, eye, brow);

  for (const side of [-1, 1]) {
    const ear = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.09, 10), steel);
    ear.rotation.z = Math.PI / 2;
    ear.position.x = side * 0.48;
    const earLight = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 10), cyan);
    earLight.rotation.z = Math.PI / 2;
    earLight.position.x = side * 0.535;
    head.add(ear, earLight);
  }

  const antenna = new THREE.Group();
  antenna.position.set(-0.22, 0.32, 0);
  const aerial = mesh(new THREE.CylinderGeometry(0.018, 0.028, 0.38, 7), steel);
  aerial.position.y = 0.18;
  aerial.rotation.z = -0.12;
  const aerialTip = mesh(new THREE.OctahedronGeometry(0.065, 0), cyan);
  aerialTip.position.set(-0.045, 0.4, 0);
  antenna.add(aerial, aerialTip);
  head.add(antenna);

  const fins: THREE.Group[] = [];
  const thrusters: THREE.Group[] = [];
  const thrusterFlames: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>[] = [];
  for (const side of [-1, 1]) {
    const pod = new THREE.Group();
    pod.position.set(side * 0.82, 1.45, 0.06);
    const shoulder = mesh(new THREE.SphereGeometry(0.25, 12, 8), paint);
    shoulder.scale.set(1.15, 0.82, 1.25);
    const guard = mesh(new THREE.BoxGeometry(0.18, 0.36, 0.58), graphite);
    guard.position.x = side * 0.19;
    guard.rotation.z = side * -0.13;
    const strip = mesh(new THREE.BoxGeometry(0.035, 0.22, 0.36), cyan);
    strip.position.set(side * 0.292, 0.02, -0.04);
    pod.add(shoulder, guard, strip);
    root.add(pod);

    const fin = new THREE.Group();
    fin.position.set(side * 0.67, 1.04, 0.2);
    const finBlade = mesh(new THREE.ConeGeometry(0.22, 0.7, 4), paintDark);
    finBlade.rotation.z = side * -0.48;
    finBlade.rotation.y = Math.PI / 4;
    const finLight = mesh(new THREE.BoxGeometry(0.035, 0.42, 0.035), cyan);
    finLight.rotation.z = side * -0.48;
    fin.add(finBlade, finLight);
    fins.push(fin);
    root.add(fin);

    const thruster = new THREE.Group();
    thruster.position.set(side * 0.48, 0.72, 0.12);
    const housing = mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.42, 10), graphite);
    const collar = mesh(new THREE.TorusGeometry(0.23, 0.045, 6, 16), steel);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = -0.22;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.72, 10, 1, true), glow.clone());
    flame.geometry.translate(0, -0.36, 0);
    flame.position.y = -0.25;
    flame.rotation.y = side * 0.14;
    thruster.add(housing, collar, flame);
    thrusters.push(thruster);
    thrusterFlames.push(flame);
    root.add(thruster);
  }

  const waist = mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.25, 12), steel);
  waist.position.y = 0.93;
  const hoverRing = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.045, 8, 32), glow.clone());
  hoverRing.rotation.x = Math.PI / 2;
  hoverRing.position.y = 0.5;
  const undercarriage = mesh(new THREE.CylinderGeometry(0.42, 0.31, 0.32, 10), graphite);
  undercarriage.position.y = 0.64;
  const trail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.7, 12, 1, true), glow.clone());
  trail.geometry.translate(0, -0.85, 0);
  trail.position.set(0, 0.72, 0.28);
  trail.rotation.x = -Math.PI / 2;
  trail.visible = false;

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.8, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;

  root.add(shadow, trail, undercarriage, hoverRing, waist, body, head);
  root.traverse((child) => {
    if (child instanceof THREE.Mesh && child !== shadow && child.material instanceof THREE.MeshStandardMaterial) {
      child.castShadow = true;
    }
  });
  return { root, body, head, visor, eye, antenna, fins, thrusters, thrusterFlames, hoverRing, trail };
}

export function animateHoverRobot(robot: HoverRobot, elapsed: number, speed: number, phase = 0): void {
  const pace = THREE.MathUtils.clamp(speed, 0, 1);
  const hover = Math.sin(elapsed * 3.4 + phase) * 0.065;
  robot.body.position.y = 1.42 + hover;
  robot.head.position.y = 2.2 + hover * 1.25;
  robot.head.rotation.y = Math.sin(elapsed * 1.35 + phase) * 0.065;
  robot.head.rotation.z = Math.sin(elapsed * 2.1 + phase) * 0.025;
  robot.antenna.rotation.z = Math.sin(elapsed * 5.4 + phase) * 0.09;
  robot.eye.position.x = 0.16 + Math.sin(elapsed * 1.7 + phase) * 0.13;
  robot.eye.scale.x = Math.sin(elapsed * 0.72 + phase) > 0.985 ? 0.08 : 1;
  robot.visor.material.emissiveIntensity = 1.45 + pace * 1.4 + Math.sin(elapsed * 4.2 + phase) * 0.18;
  robot.hoverRing.rotation.z = elapsed * (0.7 + pace * 2.4) + phase;
  robot.hoverRing.scale.setScalar(1 + Math.sin(elapsed * 5.2 + phase) * 0.055 + pace * 0.08);
  robot.hoverRing.material.opacity = 0.44 + pace * 0.38;
  robot.fins.forEach((fin, index) => {
    fin.rotation.z = (index === 0 ? -1 : 1) * (0.08 + pace * 0.28);
    fin.rotation.x = Math.sin(elapsed * 4 + phase + index) * 0.035;
  });
  robot.thrusters.forEach((thruster, index) => {
    thruster.rotation.z = (index === 0 ? -1 : 1) * pace * 0.12;
  });
  robot.thrusterFlames.forEach((flame, index) => {
    flame.scale.set(0.82 + pace * 0.48, 0.72 + pace * 1.25 + Math.sin(elapsed * 18 + index) * 0.14, 0.82 + pace * 0.48);
    flame.material.opacity = 0.48 + pace * 0.4;
  });
  robot.trail.visible = pace > 0.08;
  robot.trail.scale.set(0.7 + pace * 0.65, 0.45 + pace * 1.5, 0.7 + pace * 0.65);
  robot.trail.material.opacity = 0.12 + pace * 0.3;
}

function mesh<G extends THREE.BufferGeometry, M extends THREE.Material>(geometry: G, material: M): THREE.Mesh<G, M> {
  return new THREE.Mesh(geometry, material);
}
