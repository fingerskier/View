import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { cssVar } from "../theme";
import { actionButton, assetUrl, dirname, el, messageBox, prefs, toggleButton } from "../util";
import type { Ctx, Renderer } from "./types";

/** Formats that are conventionally authored Z-up (CAD, 3D printing, scanners). */
const Z_UP_DEFAULT = new Set(["stl", "3mf", "amf", "3ds", "pcd", "xyz"]);

const accent = () => new THREE.Color(cssVar("--accent") || "#89b4fa");

function surface(geometry: THREE.BufferGeometry): THREE.Mesh {
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const vertexColors = !!geometry.attributes.color;
  const material = new THREE.MeshStandardMaterial({
    color: vertexColors ? 0xffffff : accent(),
    vertexColors,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  material.userData.themed = !vertexColors;
  return new THREE.Mesh(geometry, material);
}

function points(geometry: THREE.BufferGeometry): THREE.Points {
  geometry.computeBoundingSphere();
  const vertexColors = !!geometry.attributes.color;
  // Constant on-screen size: world-scaled points vanish on small models.
  const material = new THREE.PointsMaterial({
    color: vertexColors ? 0xffffff : accent(),
    vertexColors,
    size: 2 * window.devicePixelRatio,
    sizeAttenuation: false,
  });
  material.userData.themed = !vertexColors;
  return new THREE.Points(geometry, material);
}

/** Give loaders' plain default materials the themed look; keep authored ones. */
function themeDefaults(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.geometry.attributes.uv && !o.geometry.attributes.color) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.every((m: THREE.Material) => !(m as THREE.MeshStandardMaterial).map && m.name === "")) {
        o.material = surface(o.geometry).material;
      }
    }
  });
}

/** Object File Format: header, counts, vertex lines, polygon lines (fan-triangulated). */
function parseOFF(text: string): THREE.BufferGeometry {
  const lines = text.split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
  const header = lines.shift() ?? "";
  if (!/OFF/i.test(header)) throw new Error("not an OFF file");
  const inline = header.replace(/^[A-Z]*OFF/i, "").trim();
  const [nv, nf] = (inline || lines.shift() || "").split(/\s+/).map(Number);
  const positions: number[] = [];
  for (let i = 0; i < nv; i++) positions.push(...lines[i].split(/\s+/).slice(0, 3).map(Number));
  const index: number[] = [];
  for (let i = 0; i < nf; i++) {
    const f = lines[nv + i].split(/\s+/).map(Number);
    const n = f[0];
    for (let k = 2; k < n; k++) index.push(f[1], f[k], f[k + 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (index.length) g.setIndex(index);
  return g;
}

async function loadModel(ctx: Ctx, manager: THREE.LoadingManager): Promise<THREE.Object3D> {
  const url = ctx.url();
  const dirUrl = `${assetUrl(dirname(ctx.path))}/`;
  const text = async () => new TextDecoder().decode(await ctx.bytes());

  switch (ctx.type.ext) {
    case "stl": {
      const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
      const g = await new STLLoader(manager).loadAsync(url);
      // Many exporters write zero facet normals; recompute (flat, since STL is unindexed).
      g.computeVertexNormals();
      return surface(g);
    }
    case "obj": {
      const { OBJLoader } = await import("three/addons/loaders/OBJLoader.js");
      const src = await text();
      const loader = new OBJLoader(manager);
      const mtl = /^mtllib\s+(.+)$/m.exec(src)?.[1]?.trim();
      if (mtl) {
        const { MTLLoader } = await import("three/addons/loaders/MTLLoader.js");
        try {
          const materials = await new MTLLoader(manager).setPath(dirUrl).loadAsync(mtl);
          materials.preload();
          loader.setMaterials(materials);
        } catch {
          /* missing .mtl: fall back to themed material */
        }
      }
      const group = loader.parse(src);
      if (!mtl) themeDefaults(group);
      return group;
    }
    case "ply": {
      const { PLYLoader } = await import("three/addons/loaders/PLYLoader.js");
      const g = await new PLYLoader(manager).loadAsync(url);
      return g.index ? surface(g) : points(g);
    }
    case "gltf":
    case "glb": {
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
      const { MeshoptDecoder } = await import("three/addons/libs/meshopt_decoder.module.js");
      const draco = new DRACOLoader(manager).setDecoderPath(new URL("vendor/draco/", document.baseURI).href);
      const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
      try {
        return (await loader.loadAsync(url)).scene;
      } finally {
        draco.dispose();
      }
    }
    case "fbx": {
      const { FBXLoader } = await import("three/addons/loaders/FBXLoader.js");
      return new FBXLoader(manager).loadAsync(url);
    }
    case "3mf": {
      const { ThreeMFLoader } = await import("three/addons/loaders/3MFLoader.js");
      const group = await new ThreeMFLoader(manager).loadAsync(url);
      themeDefaults(group);
      return group;
    }
    case "dae": {
      const { ColladaLoader } = await import("three/addons/loaders/ColladaLoader.js");
      const result = await new ColladaLoader(manager).loadAsync(url);
      if (!result) throw new Error("not a COLLADA document");
      return result.scene;
    }
    case "3ds": {
      const { TDSLoader } = await import("three/addons/loaders/TDSLoader.js");
      const loader = new TDSLoader(manager);
      loader.setResourcePath(dirUrl);
      return loader.loadAsync(url);
    }
    case "amf": {
      const { AMFLoader } = await import("three/addons/loaders/AMFLoader.js");
      const group = await new AMFLoader(manager).loadAsync(url);
      themeDefaults(group);
      return group;
    }
    case "vtk":
    case "vtp": {
      const { VTKLoader } = await import("three/addons/loaders/VTKLoader.js");
      const g = await new VTKLoader(manager).loadAsync(url);
      return g.index ? surface(g) : points(g);
    }
    case "wrl":
    case "vrml": {
      const { VRMLLoader } = await import("three/addons/loaders/VRMLLoader.js");
      return new VRMLLoader(manager).loadAsync(url);
    }
    case "pcd": {
      const { PCDLoader } = await import("three/addons/loaders/PCDLoader.js");
      const cloud = await new PCDLoader(manager).loadAsync(url);
      return points(cloud.geometry);
    }
    case "xyz": {
      const { XYZLoader } = await import("three/addons/loaders/XYZLoader.js");
      return points(await new XYZLoader(manager).loadAsync(url));
    }
    case "off":
      return surface(parseOFF(await text()));
    case "usdz":
    case "usda":
    case "usdc":
    case "usd": {
      const { USDLoader } = await import("three/addons/loaders/USDLoader.js");
      return new USDLoader(manager).loadAsync(url);
    }
  }
  throw new Error(`no loader for .${ctx.type.ext}`);
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const node = o as THREE.Mesh;
    node.geometry?.dispose();
    const mats = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}

function stats(root: THREE.Object3D): string {
  let tris = 0;
  let verts = 0;
  let pts = 0;
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    const pos = g?.attributes?.position;
    if (!pos) return;
    if (o instanceof THREE.Points) pts += pos.count;
    else if (o instanceof THREE.Mesh) {
      verts += pos.count;
      tris += (g!.index ? g!.index.count : pos.count) / 3;
    }
  });
  const parts = [];
  if (tris) parts.push(`${Math.round(tris).toLocaleString()} tris`, `${verts.toLocaleString()} verts`);
  if (pts) parts.push(`${pts.toLocaleString()} points`);
  return parts.join(" · ");
}

function niceGridSize(extent: number): number {
  const target = Math.max(extent * 2, 1e-6);
  const pow = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= target)!;
}

const mesh: Renderer = async (host, ctx) => {
  const frame = el("div", { class: "mesh-view" });
  const info = el("span", { class: "tool-info" });
  host.append(frame);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    frame.append(messageBox("error", "WebGL is not available", String(e)));
    return { update: async () => {}, dispose: () => frame.remove() };
  }
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.toneMapping = THREE.NeutralToneMapping;
  frame.append(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.7;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(0.5, 1, 0.8);
  camera.add(key);
  scene.add(camera);
  const pivot = new THREE.Group();
  scene.add(pivot);
  let grid: THREE.GridHelper | null = null;
  let model: THREE.Object3D | null = null;

  const controls = new OrbitControls(camera, renderer.domElement);
  const render = () => renderer.render(scene, camera);
  controls.addEventListener("change", render);

  const zKey = `mesh:zup:${ctx.type.ext}`;
  let zUp = prefs.get(zKey, Z_UP_DEFAULT.has(ctx.type.ext));
  let wire = false;
  let showGrid = prefs.get("mesh:grid", true);

  function applyTheme() {
    scene.background = new THREE.Color(cssVar("--bg-darker") || "#101019");
    pivot.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m?.userData?.themed) m.color = accent();
    });
    layoutGrid();
  }

  function layoutGrid() {
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      grid = null;
    }
    const box = new THREE.Box3().setFromObject(pivot);
    if (!showGrid || box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const extent = niceGridSize(Math.max(size.x, size.z));
    grid = new THREE.GridHelper(extent, 20, new THREE.Color(cssVar("--muted") || "#585b70"), new THREE.Color(cssVar("--bg-light") || "#313244"));
    grid.position.set(center.x, box.min.y, center.z);
    scene.add(grid);
  }

  function frameModel() {
    const box = new THREE.Box3().setFromObject(pivot);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-6);
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
    camera.near = dist / 1000;
    camera.far = dist * 1000;
    camera.updateProjectionMatrix();
    camera.position.copy(center).add(new THREE.Vector3(0.6, 0.45, 1).normalize().multiplyScalar(dist));
    controls.target.copy(center);
    controls.update();
  }

  function orient() {
    pivot.rotation.set(zUp ? -Math.PI / 2 : 0, 0, 0);
    pivot.updateMatrixWorld(true);
  }

  async function load(refit: boolean) {
    const manager = new THREE.LoadingManager();
    const v = ctx.version();
    // Cache-bust sibling resources (.bin, .mtl, textures) on every reload too.
    manager.setURLModifier((u) => (u.startsWith("asset:") && !u.includes("?") ? `${u}?v=${v}` : u));
    let next: THREE.Object3D;
    try {
      next = await loadModel(ctx, manager);
    } catch (e) {
      frame.querySelector(".message")?.remove();
      frame.append(messageBox("error", `Could not load this .${ctx.type.ext} file`, e instanceof Error ? e.message : String(e)));
      return;
    }
    frame.querySelector(".message")?.remove();
    if (model) {
      pivot.remove(model);
      disposeObject(model);
    }
    model = next;
    pivot.add(model);
    if (wire) setWire(true);
    orient();
    applyTheme();
    if (refit) frameModel();
    info.textContent = stats(model);
    render();
  }

  function setWire(on: boolean) {
    wire = on;
    pivot.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
        if ("wireframe" in m) (m as THREE.MeshStandardMaterial).wireframe = on;
      }
    });
    render();
  }

  toggleButton(ctx.tools, "Wire", wire, setWire, { key: "w", title: "Wireframe (w)" });
  toggleButton(ctx.tools, "Z-up", zUp, (on) => {
    zUp = on;
    prefs.set(zKey, on);
    orient();
    layoutGrid();
    frameModel();
    render();
  }, { key: "z", title: "Treat +Z as up (z)" });
  toggleButton(ctx.tools, "Grid", showGrid, (on) => {
    showGrid = on;
    prefs.set("mesh:grid", on);
    layoutGrid();
    render();
  }, { key: "#", title: "Ground grid (#)" });
  actionButton(ctx.tools, "Reset", () => {
    frameModel();
    render();
  }, { key: "0", title: "Reset view (0)" });
  ctx.tools.append(info);

  const resize = new ResizeObserver(() => {
    const { clientWidth: w, clientHeight: h } = frame;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  });
  resize.observe(frame);

  await load(true);
  return {
    update: () => load(false),
    retheme: () => {
      applyTheme();
      render();
    },
    dispose: () => {
      resize.disconnect();
      controls.dispose();
      if (model) disposeObject(model);
      scene.environment?.dispose();
      pmrem.dispose();
      room.dispose?.();
      renderer.dispose();
      renderer.forceContextLoss();
      frame.remove();
    },
  };
};

export default mesh;
