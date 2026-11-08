import {
  AmbientLight, DirectionalLight, Euler, ExtrudeGeometry, Group,
  Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PerspectiveCamera,
  PlaneGeometry, PMREMGenerator, Quaternion, Scene, Shape,
  SRGBColorSpace, TextureLoader, Vector2, Vector3, WebGLRenderer,
  DoubleSide,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const stage = document.querySelector('.card-stage');
const canvas = document.querySelector('.card-canvas');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// Edit these independently of the artwork. Dimensions use an 85 mm wide card.
const CARD_WIDTH = 3.6;
const CARD_HEIGHT = CARD_WIDTH * 590 / 976;
const CARD_DEPTH = 0.055;
const CARD_OPACITY = 0.96;

function roundedOutline(width, height, radius) {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

export async function createCard({ showReady, showFallback }) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0xffffff, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 100);
  const room = new RoomEnvironment();
  const generator = new PMREMGenerator(renderer);
  const environment = generator.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.8;
  room.dispose();
  generator.dispose();
  scene.add(new AmbientLight(0xffffff, 1.4));
  const light = new DirectionalLight(0xffffff, 2);
  light.position.set(-3, 5, 6);
  scene.add(light);

  const card = new Group();
  const initialRotation = new Quaternion().setFromEuler(new Euler(-0.2, -0.34, -0.035));
  card.quaternion.copy(initialRotation);
  scene.add(card);

  const outline = roundedOutline(CARD_WIDTH, CARD_HEIGHT, 0.065);
  const geometry = new ExtrudeGeometry(outline, {
    depth: CARD_DEPTH - 0.016,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 3,
    curveSegments: 10,
    steps: 1,
  });
  geometry.translate(0, 0, -(CARD_DEPTH - 0.016) / 2);
  const faceMaterial = new MeshPhysicalMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: CARD_OPACITY,
    roughness: 0.23,
    metalness: 0,
    ior: 1.49,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    envMapIntensity: 0.45,
    depthWrite: false,
  });
  const edgeMaterial = new MeshPhysicalMaterial({
    color: 0xbfcbd0,
    transparent: true,
    opacity: 0.8,
    roughness: 0.12,
    metalness: 0,
    ior: 1.49,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.1,
    depthWrite: false,
  });
  card.add(new Mesh(geometry, [faceMaterial, edgeMaterial]));

  const textureLoader = new TextureLoader();
  const textures = await Promise.all([
    textureLoader.loadAsync('./assets/card-front.png'),
    textureLoader.loadAsync('./assets/card-back.png'),
  ]);
  const printGeometry = new PlaneGeometry(CARD_WIDTH, CARD_HEIGHT);
  const printMaterials = textures.map(texture => {
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    return new MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
      alphaTest: 0.01,
      toneMapped: false,
    });
  });
  const front = new Mesh(printGeometry, printMaterials[0]);
  front.position.z = CARD_DEPTH / 2 + 0.001;
  const back = new Mesh(printGeometry, printMaterials[1]);
  back.position.z = -CARD_DEPTH / 2 - 0.001;
  back.rotation.y = Math.PI;
  card.add(front, back);

  let frame = 0;
  let previousTime = 0;
  let activePointer = null;
  let lastPointerTime = 0;
  let resetting = false;
  let disposed = false;
  let presented = false;
  const pointer = new Vector2();
  const velocity = new Vector2();
  const axis = new Vector3();
  const deltaRotation = new Quaternion();
  const faceNormal = new Vector3();

  function rotate(dx, dy) {
    const length = Math.hypot(dx, dy);
    if (length === 0) return;
    // Premultiplication keeps every drag relative to the screen, even upside down.
    axis.set(dy / length, dx / length, 0);
    deltaRotation.setFromAxisAngle(axis, length * Math.PI / Math.max(stage.clientWidth * 0.82, 1));
    card.quaternion.premultiply(deltaRotation).normalize();
  }

  function requestRender() {
    if (!frame && !disposed && !document.hidden) frame = requestAnimationFrame(render);
  }

  function render(time) {
    frame = 0;
    const elapsed = Math.min((time - previousTime) / 1000 || 1 / 60, 0.032);
    previousTime = time;
    if (resetting) {
      card.quaternion.slerp(initialRotation, 1 - Math.exp(-12 * elapsed));
      if (card.quaternion.angleTo(initialRotation) < 0.001) {
        card.quaternion.copy(initialRotation);
        resetting = false;
      }
    } else if (activePointer === null && !reducedMotion.matches && velocity.length() > 2) {
      rotate(velocity.x * elapsed, velocity.y * elapsed);
      velocity.multiplyScalar(Math.exp(-7 * elapsed));
    } else if (activePointer === null) {
      velocity.set(0, 0);
    }
    faceNormal.set(0, 0, 1).applyQuaternion(card.quaternion);
    const face = faceNormal.z > 0.12 ? 'Front' : faceNormal.z < -0.12 ? 'Back' : 'Edge';
    canvas.setAttribute('aria-label', face + ' of business card. Drag or use arrow keys to rotate.');
    try {
      renderer.render(scene, camera);
    } catch (error) {
      disposed = true;
      console.warn('The 3D card could not be rendered.', error);
      showFallback();
      return;
    }
    if (!presented) {
      presented = true;
      showReady();
    }
    if (resetting || (activePointer === null && velocity.length() > 2)) requestRender();
  }

  function resize() {
    const { width, height } = stage.getBoundingClientRect();
    if (!width || !height) return;
    camera.aspect = width / height;
    const halfFov = Math.tan(camera.fov * Math.PI / 360);
    // Fit the diagonal so vertical and diagonal rotation stay within a mobile viewport.
    const diameter = Math.hypot(CARD_WIDTH, CARD_HEIGHT);
    camera.position.z = Math.max(diameter / (2 * halfFov * camera.aspect * 0.9), diameter / (2 * halfFov * 0.86));
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    requestRender();
  }

  function reset() {
    velocity.set(0, 0);
    if (reducedMotion.matches) card.quaternion.copy(initialRotation);
    else resetting = true;
    requestRender();
  }

  canvas.addEventListener('pointerdown', event => {
    if (activePointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    activePointer = event.pointerId;
    pointer.set(event.clientX, event.clientY);
    velocity.set(0, 0);
    resetting = false;
    lastPointerTime = performance.now();
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    stage.classList.add('card-stage--dragging');
  });

  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== activePointer) return;
    const now = performance.now();
    const elapsed = Math.max((now - lastPointerTime) / 1000, 0.008);
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    rotate(dx, dy);
    velocity.set(dx / elapsed, dy / elapsed).clampLength(0, 650);
    pointer.set(event.clientX, event.clientY);
    lastPointerTime = now;
    requestRender();
  });

  function release(event) {
    if (event.pointerId !== activePointer) return;
    activePointer = null;
    if (event.type !== 'pointerup' || performance.now() - lastPointerTime > 90 || reducedMotion.matches) velocity.set(0, 0);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    stage.classList.remove('card-stage--dragging');
    requestRender();
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, release);

  canvas.addEventListener('keydown', event => {
    const movement = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] }[event.key];
    if (movement) {
      event.preventDefault();
      resetting = false;
      velocity.set(0, 0);
      rotate(...movement);
      requestRender();
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      reset();
    }
  });
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  document.addEventListener('visibilitychange', () => {
    velocity.set(0, 0);
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else requestRender();
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    cancelAnimationFrame(frame);
    frame = 0;
    disposed = true;
    presented = false;
    showFallback();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    disposed = false;
    resize();
  });
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    geometry.dispose();
    printGeometry.dispose();
    faceMaterial.dispose();
    edgeMaterial.dispose();
    printMaterials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
    environment.dispose();
    renderer.dispose();
  });

  resize();
}
