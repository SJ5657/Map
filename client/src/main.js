import { fetchLocations, fetchLocationPOIs, checkServerHealth } from "./api.js";

// 글로벌 상태
let locationsList = [];
let currentLocation = {
  id: "cheongdam",
  name: "서울 강남구 청담역 (7호선)",
  lat: 37.519200,
  lng: 127.053100
};
let currentPois = [];

// Canvas & Babylon Engine Variables
const canvas = document.getElementById("renderCanvas");
let engine, scene, camera, dirLight, hemiLight, shadowGenerator, glowLayer;
let skyDome, skyTexture, skyContext, sunMesh, sunHalo;
let character;
let ground, groundMaterial, mapDynamicTexture;
let mapCanvas, mapContext;
let mapStyle = 'light'; // 'light' | 'dark' | 'satellite'
let guiTexture;
const poi3DNodes = [];
let showPOIs = false;

// Movement & VRM Animation States
const inputMap = {};
let isMoving = false;
let isRunToggled = false; // R키로 걷기/달리기 고정 토글 지원
let isRunning = false;
let currentSpeed = 0;
const walkMaxSpeed = 7.5;
const runMaxSpeed = 16.0;
let targetRotationY = 0;

// VRM Skeleton & Retargeted Animation Data
let vrmLoaded = false;
let vrmBoneNodes = {};
let vrmAnimData = null;
let animIdleTime = 0;
let animWalkTime = 0;
let animRunTime = 0;
const animWeights = { idle: 1.0, walk: 0.0, run: 0.0 };

// Pre-allocated temp objects for zero-GC real-time Slerp blending
let _qIdle, _qWalk, _qRun, _qLoco, _qF0, _qF1, _qNeg;
let _vIdle, _vWalk, _vRun, _vLoco, _vF0, _vF1;

// Mouse Camera Control States
let isPointerDragging = false;
let lastPointerX = 0;
let lastPointerY = 0;
let isPointerLocked = false;
let mouseLookEnabled = true; // 마우스 클릭 없이 마우스 이동만으로 시점 회전 기본 활성화
let prevMouseX = null;
let prevMouseY = null;

// Geographic Conversions Constants (Simulated Lat/Lng to World Scale)
const LAT_DEGREE_IN_METERS = 111000;
const METERS_PER_UNIT = 5;

// Google Maps Exact Color Palette Constants
const GMAP_COLORS = {
  subway7: "#747F00",
  subway2: "#2DB400",
  subway9: "#BDB092",
  subwayShin: "#D4003B",
  hospital: "#EA4335",
  shopping: "#F29900",
  food: "#E65100",
  landmark: "#1A73E8",
  park: "#137333",
  transit: "#0070C0"
};

// --- PROCEDURAL GOOGLE MAPS 2D CANVASES & VECTOR LABELS ---
function createMapCanvasTexture() {
  mapCanvas = document.createElement("canvas");
  mapCanvas.width = 2048;
  mapCanvas.height = 2048;
  mapContext = mapCanvas.getContext("2d");

  // DynamicTexture를 먼저 생성한 뒤 renderMapTexture()를 호출하여 초기 프레임부터 즉시 지도가 GPU에 업로드/활성화되도록 보장
  mapDynamicTexture = new BABYLON.DynamicTexture("mapDynamicTexture", mapCanvas, scene, true);
  mapDynamicTexture.anisotropicFilteringLevel = 8;
  renderMapTexture();
  return mapDynamicTexture;
}

function renderMapTexture() {
  if (!mapContext) return;
  const ctx = mapContext;
  const w = mapCanvas.width;
  const h = mapCanvas.height;

  // 순수 지형(Terrain-only) 테마 팔레트 (건물, 도로, 텍스트 라벨, POI 제외)
  const colors = {
    light: {
      bg: "#f1f5ec",
      plain: "#e7efe0",
      park: "#d3e8c9",
      forest: "#b8dbb0",
      hillShadow: "rgba(120, 155, 110, 0.16)",
      contour: "rgba(110, 145, 100, 0.25)",
      shore: "#e8dfc8",
      water: "#a8ccf7",
      waterDeep: "#8bb8f0"
    },
    dark: {
      bg: "#141c18",
      plain: "#18241e",
      park: "#132e22",
      forest: "#0e261b",
      hillShadow: "rgba(5, 15, 10, 0.35)",
      contour: "rgba(74, 124, 98, 0.22)",
      shore: "#242822",
      water: "#173254",
      waterDeep: "#102542"
    },
    satellite: {
      bg: "#26351e",
      plain: "#2d4023",
      park: "#1e3615",
      forest: "#152b0e",
      hillShadow: "rgba(0, 0, 0, 0.28)",
      contour: "rgba(160, 195, 130, 0.15)",
      shore: "#4a4635",
      water: "#113047",
      waterDeep: "#0b2236"
    }
  }[mapStyle];

  // 1. 기본 대지 배경 (Base Terrain Ground)
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, w, h);

  // 완만한 평야/지형 색조 변화
  const plainGrad = ctx.createRadialGradient(w * 0.5, h * 0.55, w * 0.05, w * 0.5, h * 0.55, w * 0.7);
  plainGrad.addColorStop(0, colors.plain);
  plainGrad.addColorStop(1, colors.bg);
  ctx.fillStyle = plainGrad;
  ctx.fillRect(0, 0, w, h);

  // 2. 자연 녹지 및 구릉 지형 (Parks, Forests & Natural Hills)
  const hillRegions = [
    { cx: w * 0.26, cy: h * 0.72, rx: w * 0.22, ry: h * 0.18, rot: -0.2 },
    { cx: w * 0.76, cy: h * 0.68, rx: w * 0.20, ry: h * 0.22, rot: 0.35 },
    { cx: w * 0.82, cy: h * 0.36, rx: w * 0.15, ry: h * 0.12, rot: -0.4 },
    { cx: w * 0.18, cy: h * 0.38, rx: w * 0.14, ry: h * 0.11, rot: 0.15 },
    { cx: w * 0.52, cy: h * 0.86, rx: w * 0.25, ry: h * 0.12, rot: 0.05 }
  ];

  hillRegions.forEach((hill) => {
    ctx.save();
    ctx.translate(hill.cx, hill.cy);
    ctx.rotate(hill.rot);

    // 외곽 구릉 사면
    ctx.fillStyle = colors.park;
    ctx.beginPath();
    ctx.ellipse(0, 0, hill.rx, hill.ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // 내부 짙은 식생/고지대 영역
    ctx.fillStyle = colors.forest;
    ctx.beginPath();
    ctx.ellipse(-hill.rx * 0.08, -hill.ry * 0.06, hill.rx * 0.65, hill.ry * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();

    // 등고선 (Contour Lines) 표현
    ctx.strokeStyle = colors.contour;
    ctx.lineWidth = 2;
    for (let s = 1.15; s >= 0.35; s -= 0.2) {
      ctx.beginPath();
      ctx.ellipse(0, 0, hill.rx * s, hill.ry * s, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  });

  // 전역 자연 등고선 결 추가
  ctx.strokeStyle = colors.contour;
  ctx.lineWidth = 1.5;
  for (let i = 1; i <= 5; i++) {
    ctx.beginPath();
    const yBase = h * (0.28 + i * 0.13);
    ctx.moveTo(0, yBase);
    ctx.bezierCurveTo(
      w * 0.33, yBase - 45 * Math.sin(i),
      w * 0.66, yBase + 45 * Math.cos(i),
      w, yBase - 20 * Math.sin(i * 1.5)
    );
    ctx.stroke();
  }

  // 3. 수변 모래톱/기슭 (Shoreline) & 강/하천 지형 (Water Body)
  ctx.fillStyle = colors.shore;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.165);
  ctx.bezierCurveTo(w * 0.3, h * 0.115, w * 0.5, h * 0.365, w, h * 0.235);
  ctx.lineTo(w, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();

  const waterGrad = ctx.createLinearGradient(0, 0, 0, h * 0.35);
  waterGrad.addColorStop(0, colors.waterDeep);
  waterGrad.addColorStop(1, colors.water);
  ctx.fillStyle = waterGrad;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.15);
  ctx.bezierCurveTo(w * 0.3, h * 0.1, w * 0.5, h * 0.35, w, h * 0.22);
  ctx.lineTo(w, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();

  if (mapDynamicTexture) {
    mapDynamicTexture.update();
  }
}

// --- 3D FLOATING POI BILLBOARD OVERLAYS (지형 전용 모드에서는 비활성화) ---
function rebuild3DPOIMarkers() {
  poi3DNodes.forEach(node => node.dispose());
  poi3DNodes.length = 0;
}

// --- VRM CHARACTER CREATION & MTOON / MOCAP ANIMATION SYSTEM ---
function initAnimTempObjects() {
  _qIdle = new BABYLON.Quaternion();
  _qWalk = new BABYLON.Quaternion();
  _qRun = new BABYLON.Quaternion();
  _qLoco = new BABYLON.Quaternion();
  _qF0 = new BABYLON.Quaternion();
  _qF1 = new BABYLON.Quaternion();
  _qNeg = new BABYLON.Quaternion();

  _vIdle = new BABYLON.Vector3();
  _vWalk = new BABYLON.Vector3();
  _vRun = new BABYLON.Vector3();
  _vLoco = new BABYLON.Vector3();
  _vF0 = new BABYLON.Vector3();
  _vF1 = new BABYLON.Vector3();
}

function shortestSlerpToRef(qA, qB, t, result) {
  const dot = qA.x * qB.x + qA.y * qB.y + qA.z * qB.z + qA.w * qB.w;
  if (dot < 0) {
    _qNeg.set(-qB.x, -qB.y, -qB.z, -qB.w);
    BABYLON.Quaternion.SlerpToRef(qA, _qNeg, t, result);
  } else {
    BABYLON.Quaternion.SlerpToRef(qA, qB, t, result);
  }
}

function sampleClipBoneQuat(clip, boneName, time, outQuat) {
  const track = clip.bones[boneName];
  if (!track || track.length === 0) return false;
  const normTime = ((time % clip.duration) + clip.duration) % clip.duration;
  const exactFrame = (normTime / clip.duration) * (clip.numFrames - 1);
  const f0 = Math.floor(exactFrame);
  const f1 = Math.min(clip.numFrames - 1, f0 + 1);
  const alpha = exactFrame - f0;

  const k0 = track[f0];
  const k1 = track[f1];
  _qF0.set(k0[0], k0[1], k0[2], k0[3]);
  _qF1.set(k1[0], k1[1], k1[2], k1[3]);
  shortestSlerpToRef(_qF0, _qF1, alpha, outQuat);
  return true;
}

function sampleClipHipsPos(clip, time, outVec) {
  const track = clip.hipsPosition;
  if (!track || track.length === 0) return false;
  const normTime = ((time % clip.duration) + clip.duration) % clip.duration;
  const exactFrame = (normTime / clip.duration) * (clip.numFrames - 1);
  const f0 = Math.floor(exactFrame);
  const f1 = Math.min(clip.numFrames - 1, f0 + 1);
  const alpha = exactFrame - f0;

  const p0 = track[f0];
  const p1 = track[f1];
  _vF0.set(p0[0], p0[1], p0[2]);
  _vF1.set(p1[0], p1[1], p1[2]);
  BABYLON.Vector3.LerpToRef(_vF0, _vF1, alpha, outVec);
  return true;
}

function applyMToonMaterials(meshes, mtoonMaterialsMap) {
  meshes.forEach((mesh) => {
    if (!mesh || mesh.name === "__root__") return;

    mesh.alwaysSelectAsActiveMesh = true;
    if (shadowGenerator && mesh.getTotalVertices && mesh.getTotalVertices() > 0) {
      shadowGenerator.addShadowCaster(mesh, true);
    }

    const mat = mesh.material;
    if (!mat) return;

    const mtoon = mtoonMaterialsMap ? mtoonMaterialsMap[mat.name] : null;
    const isBodyOrHair =
      mat.name.includes("SKIN") ||
      mat.name.includes("CLOTH") ||
      mat.name.includes("HAIR");

    if (isBodyOrHair) {
      // 전신(피부, 의상, 헤어)에 은은하고 매끈한 피규어 광택(Glossy + ClearCoat) 적용
      mat.unlit = false;
      mat.metallic = 0.08;
      mat.roughness = 0.26;
      mat.environmentIntensity = 0.85;
      mat.specularIntensity = 1.15;

      // 그림자 영역이 시커멓게 죽지 않고 원래 색감을 화사하게 유지하도록 자체 발광 밸런스 적용
      if (mat.albedoTexture) {
        mat.emissiveTexture = mat.albedoTexture;
        mat.emissiveColor = new BABYLON.Color3(0.46, 0.44, 0.40);
      }

      // 겉면에 투명 코팅층(ClearCoat) 광택 추가
      if (mat.clearCoat) {
        mat.clearCoat.isEnabled = true;
        mat.clearCoat.intensity = 0.55;
        mat.clearCoat.roughness = 0.14;
      }
    } else if ("unlit" in mat) {
      // 눈동자, 하이라이트, 눈썹, 입선 등은 또렷한 2D 애니메이션 표현 유지
      mat.unlit = true;
    }

    if (mtoon) {
      mat.backFaceCulling = !mtoon.doubleSided;

      if (mtoon.alphaMode === "MASK") {
        mat.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_ALPHATEST;
        mat.alphaCutOff = mtoon.alphaCutoff ?? 0.5;
      } else if (mtoon.alphaMode === "BLEND") {
        mat.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_ALPHABLEND;
        mat.separateCullingPass = false;
        mesh.alphaIndex = 20 + (mtoon.renderQueueOffsetNumber || 0);
      } else {
        mat.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_OPAQUE;
      }
    }
  });
}

async function createCharacter() {
  initAnimTempObjects();
  character = new BABYLON.TransformNode("character", scene);

  // 고해상도 실시간 그림자 생성기 (캐릭터 이동을 따라가는 정밀 PCF 그림자)
  shadowGenerator = new BABYLON.ShadowGenerator(2048, dirLight);
  shadowGenerator.usePercentageCloserFiltering = true;
  shadowGenerator.filteringQuality = BABYLON.ShadowGenerator.QUALITY_HIGH;
  shadowGenerator.bias = 0.0006;
  shadowGenerator.normalBias = 0.008;
  shadowGenerator.darkness = 0.22; // 선명하고 자연스러운 그림자 농도
  shadowGenerator.transparencyShadow = true;

  try {
    // 1. MoCapCentral FBX에서 리타겟팅된 애니메이션 JSON 및 VRM 모델 병렬 로드
    const [animResp, importResult] = await Promise.all([
      fetch("/models/animations.json").then((r) => r.json()),
      BABYLON.SceneLoader.ImportMeshAsync("", "/models/", "MapGirl.vrm", scene, null, ".glb")
    ]);

    vrmAnimData = animResp;

    // 2. 내장 glTF 애니메이션 정지
    if (importResult.animationGroups) {
      importResult.animationGroups.forEach((ag) => ag.stop());
    }

    // 3. VRM 루트 노드를 컨테이너에 연결하여 씬 스케일(2.2배)에 맞게 조정 (__root__의 좌표계 변환 보존)
    const vrmRoot = importResult.meshes[0];
    const vrmContainer = new BABYLON.TransformNode("vrmContainer", scene);
    vrmContainer.parent = character;
    vrmContainer.scaling = new BABYLON.Vector3(2.2, 2.2, 2.2);
    vrmRoot.parent = vrmContainer;

    // 4. VRM 휴머노이드 본 TransformNode 매핑
    vrmBoneNodes = {};
    importResult.transformNodes.forEach((node) => {
      vrmBoneNodes[node.name] = node;
      if (!node.rotationQuaternion) {
        node.rotationQuaternion = BABYLON.Quaternion.FromEulerVector(node.rotation);
      }
    });

    // 5. MToon 재질 및 카툰 아웃라인 적용
    applyMToonMaterials(importResult.meshes, vrmAnimData.mtoonMaterials);

    vrmLoaded = true;
    updateVRMAnimation(0);
    console.log("VRM 캐릭터(MapGirl.vrm) 및 MoCapCentral(Idle/Walk/Run) 애니메이션 로드 완료!");
  } catch (err) {
    console.error("VRM 캐릭터 로드 중 오류 발생:", err);
  }
}

function updateVRMAnimation(delta) {
  if (!vrmLoaded || !vrmAnimData || !vrmAnimData.clips) return;

  const { idle, walk, run } = vrmAnimData.clips;

  // 목표 모션 가중치 계산 (Idle / Walk / Run)
  const targetIdle = isMoving ? 0.0 : 1.0;
  const targetWalk = (isMoving && !isRunning) ? 1.0 : 0.0;
  const targetRun = (isMoving && isRunning) ? 1.0 : 0.0;

  // 부드러운 크로스페이드 블렌딩 (약 0.12초 전환)
  const blendRate = delta > 0 ? Math.min(1.0, delta * 9.0) : 1.0;
  animWeights.idle += (targetIdle - animWeights.idle) * blendRate;
  animWeights.walk += (targetWalk - animWeights.walk) * blendRate;
  animWeights.run += (targetRun - animWeights.run) * blendRate;

  const sumW = animWeights.idle + animWeights.walk + animWeights.run;
  const wIdle = sumW > 0.0001 ? animWeights.idle / sumW : 1.0;
  const wWalk = sumW > 0.0001 ? animWeights.walk / sumW : 0.0;
  const wRun = sumW > 0.0001 ? animWeights.run / sumW : 0.0;
  const wLoco = wWalk + wRun;
  const runRatio = wLoco > 0.0001 ? wRun / wLoco : 0.0;

  // 각 클립 재생 시간 전진
  animIdleTime += delta;
  animWalkTime += delta * 1.1; // 걷기 배속 자연스럽게 보정
  animRunTime += delta * 1.05; // 달리기 배속

  // 1. Hips (골반) 상하 바운스 및 좌우 중심 이동 보간
  const hipsNode = vrmBoneNodes["J_Bip_C_Hips"];
  if (hipsNode) {
    sampleClipHipsPos(idle, animIdleTime, _vIdle);
    if (wLoco > 0.001) {
      sampleClipHipsPos(walk, animWalkTime, _vWalk);
      sampleClipHipsPos(run, animRunTime, _vRun);
      BABYLON.Vector3.LerpToRef(_vWalk, _vRun, runRatio, _vLoco);
      BABYLON.Vector3.LerpToRef(_vIdle, _vLoco, wLoco, hipsNode.position);
    } else {
      hipsNode.position.copyFrom(_vIdle);
    }
  }

  // 2. 전신 휴머노이드 본(척추, 목, 머리, 팔, 다리, 손가락) 회전 쿼터니언 Slerp 블렌딩
  const boneNames = Object.keys(idle.bones);
  for (let i = 0; i < boneNames.length; i++) {
    const boneName = boneNames[i];
    const node = vrmBoneNodes[boneName];
    if (!node || !node.rotationQuaternion) continue;

    sampleClipBoneQuat(idle, boneName, animIdleTime, _qIdle);

    if (wLoco > 0.001) {
      if (wWalk > 0.001 && wRun > 0.001) {
        sampleClipBoneQuat(walk, boneName, animWalkTime, _qWalk);
        sampleClipBoneQuat(run, boneName, animRunTime, _qRun);
        shortestSlerpToRef(_qWalk, _qRun, runRatio, _qLoco);
      } else if (wRun >= wWalk) {
        sampleClipBoneQuat(run, boneName, animRunTime, _qLoco);
      } else {
        sampleClipBoneQuat(walk, boneName, animWalkTime, _qLoco);
      }

      if (wIdle > 0.001) {
        shortestSlerpToRef(_qIdle, _qLoco, wLoco, node.rotationQuaternion);
      } else {
        node.rotationQuaternion.copyFrom(_qLoco);
      }
    } else {
      node.rotationQuaternion.copyFrom(_qIdle);
    }
  }
}

// --- 3D SKYDOME, SUN & ATMOSPHERIC REFLECTION ---
function renderSkyDomeTexture() {
  if (!skyContext) return;
  const ctx = skyContext;
  const w = 1024;
  const h = 512;

  const isDark = mapStyle === "dark";
  const grad = ctx.createLinearGradient(0, 0, 0, h);

  if (isDark) {
    grad.addColorStop(0.0, "#020617");
    grad.addColorStop(0.35, "#0f172a");
    grad.addColorStop(0.48, "#1e293b");
    grad.addColorStop(0.52, "#334155");
    grad.addColorStop(1.0, "#090d16");
  } else {
    // 맑고 청량한 하늘 그라데이션 (천정 코발트 블루 -> 지평선 웜 시안/골든 헤이즈)
    grad.addColorStop(0.0, "#0c4a6e");
    grad.addColorStop(0.22, "#0284c7");
    grad.addColorStop(0.42, "#38bdf8");
    grad.addColorStop(0.49, "#bae6fd");
    grad.addColorStop(0.51, "#fef3c7");
    grad.addColorStop(0.60, "#e2e8f0");
    grad.addColorStop(1.0, "#94a3b8");
  }

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 부드러운 구름 레이어 표현
  ctx.save();
  for (let i = 0; i < 28; i++) {
    const cx = ((i * 173) % w);
    const cy = h * 0.25 + ((i * 47) % (h * 0.20));
    const rx = 50 + ((i * 29) % 75);
    const ry = 12 + ((i * 19) % 20);
    const cloudGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, rx);
    if (isDark) {
      cloudGrad.addColorStop(0, "rgba(148, 163, 184, 0.14)");
      cloudGrad.addColorStop(1, "rgba(15, 23, 42, 0)");
    } else {
      cloudGrad.addColorStop(0, "rgba(255, 255, 255, 0.72)");
      cloudGrad.addColorStop(0.55, "rgba(255, 255, 255, 0.32)");
      cloudGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
    }
    ctx.fillStyle = cloudGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (skyTexture) {
    skyTexture.update();
  }

  if (scene) {
    if (isDark) {
      scene.fogColor = new BABYLON.Color3(0.08, 0.11, 0.18);
      scene.clearColor = new BABYLON.Color4(0.04, 0.06, 0.12, 1);
    } else {
      scene.fogColor = new BABYLON.Color3(0.76, 0.89, 0.98);
      scene.clearColor = new BABYLON.Color4(0.55, 0.80, 0.96, 1);
    }
  }
}

function createSkyAndSun() {
  // 1. 스카이돔 (하늘 구체)
  skyDome = BABYLON.MeshBuilder.CreateSphere(
    "skyDome",
    { diameter: 1400, segments: 32, sideOrientation: BABYLON.Mesh.BACKSIDE },
    scene
  );
  skyDome.infiniteDistance = true;
  skyDome.applyFog = false;
  skyDome.isPickable = false;

  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 1024;
  skyCanvas.height = 512;
  skyContext = skyCanvas.getContext("2d");

  skyTexture = new BABYLON.DynamicTexture("skyDomeTex", skyCanvas, scene, false);
  renderSkyDomeTexture();

  const skyMat = new BABYLON.StandardMaterial("skyMat", scene);
  skyMat.backFaceCulling = false;
  skyMat.disableLighting = true;
  skyMat.emissiveTexture = skyTexture;
  skyMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
  skyMat.specularColor = new BABYLON.Color3(0, 0, 0);
  skyDome.material = skyMat;

  // 2. 태양 (해 구체 + 코로나 광채 빌보드)
  const sunPosition = new BABYLON.Vector3(180, 260, 160);

  sunMesh = BABYLON.MeshBuilder.CreateSphere("sunMesh", { diameter: 28, segments: 24 }, scene);
  sunMesh.position.copyFrom(sunPosition);
  sunMesh.applyFog = false;
  sunMesh.isPickable = false;

  const sunMat = new BABYLON.StandardMaterial("sunMat", scene);
  sunMat.disableLighting = true;
  sunMat.emissiveColor = new BABYLON.Color3(1.0, 0.96, 0.78);
  sunMesh.material = sunMat;

  // 태양 광채(Corona & Sunbeams) 텍스처 빌보드
  const haloCanvas = document.createElement("canvas");
  haloCanvas.width = 256;
  haloCanvas.height = 256;
  const hCtx = haloCanvas.getContext("2d");
  const hGrad = hCtx.createRadialGradient(128, 128, 8, 128, 128, 124);
  hGrad.addColorStop(0.0, "rgba(255, 255, 240, 1.0)");
  hGrad.addColorStop(0.22, "rgba(255, 230, 140, 0.75)");
  hGrad.addColorStop(0.55, "rgba(255, 190, 70, 0.25)");
  hGrad.addColorStop(1.0, "rgba(255, 160, 30, 0.0)");
  hCtx.fillStyle = hGrad;
  hCtx.fillRect(0, 0, 256, 256);

  const haloTex = new BABYLON.DynamicTexture("sunHaloTex", haloCanvas, scene, false);
  haloTex.hasAlpha = true;
  haloTex.update();

  sunHalo = BABYLON.MeshBuilder.CreatePlane("sunHalo", { size: 120 }, scene);
  sunHalo.position.copyFrom(sunPosition);
  sunHalo.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  sunHalo.applyFog = false;
  sunHalo.isPickable = false;

  const haloMat = new BABYLON.StandardMaterial("sunHaloMat", scene);
  haloMat.disableLighting = true;
  haloMat.emissiveTexture = haloTex;
  haloMat.opacityTexture = haloTex;
  haloMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
  haloMat.backFaceCulling = false;
  sunHalo.material = haloMat;

  // 3. 글로벌 블룸/빛번짐(GlowLayer) 및 전체 환경 반사 프로브(ReflectionProbe)
  glowLayer = new BABYLON.GlowLayer("sunGlowLayer", scene, { blurKernelSize: 32 });
  glowLayer.intensity = 0.55;
  glowLayer.addIncludedOnlyMesh(sunMesh);

  try {
    const skyProbe = new BABYLON.ReflectionProbe("skyProbe", 128, scene, false);
    skyProbe.renderList.push(skyDome);
    skyProbe.renderList.push(sunMesh);
    skyProbe.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    scene.environmentTexture = skyProbe.cubeTexture;
    scene.environmentIntensity = 0.9;
  } catch (_) {}
}

// --- MAIN SCENE INITIALIZATION ---
function createScene() {
  scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.55, 0.80, 0.96, 1);

  // 지평선 대기 원근감 안개
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0014;
  scene.fogColor = new BABYLON.Color3(0.76, 0.89, 0.98);

  camera = new BABYLON.ArcRotateCamera("TiltedMapCamera", -Math.PI / 2, Math.PI / 3, 28, BABYLON.Vector3.Zero(), scene);
  camera.lowerBetaLimit = 0.12;       // 약 7도 (수직 탑다운 조망 가능)
  camera.upperBetaLimit = Math.PI / 2.05; // 약 87도 (수평 3인칭으로 하늘/태양 조망 가능)
  camera.lowerRadiusLimit = 5;
  camera.upperRadiusLimit = 90;
  camera.wheelPrecision = 20;
  camera.maxZ = 2500;

  // Babylon 컨트롤 연결 후 키보드 이동 및 내장 포인터 제거 (커스텀 마우스 드래그 & 마우스 룩 사용)
  camera.attachControl(canvas, true);
  if (camera.inputs) {
    camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
    camera.inputs.removeByType("ArcRotateCameraPointersInput");
  }

  // 태양 직사광 (DirectionalLight) & 정밀 그림자 영역 설정
  const sunDir = new BABYLON.Vector3(-180, -260, -160).normalize();
  dirLight = new BABYLON.DirectionalLight("dir01", sunDir, scene);
  dirLight.position = new BABYLON.Vector3(22, 32, 20);
  dirLight.intensity = 1.25;
  dirLight.diffuse = new BABYLON.Color3(1.0, 0.98, 0.92);
  dirLight.specular = new BABYLON.Color3(1.0, 0.96, 0.86);

  // 캐릭터 주변에 그림자 해상도를 집중시켜 선명한 그림자 보장
  dirLight.autoUpdateExtends = false;
  dirLight.orthoLeft = -16;
  dirLight.orthoRight = 16;
  dirLight.orthoTop = 16;
  dirLight.orthoBottom = -16;
  dirLight.shadowMinZ = 2;
  dirLight.shadowMaxZ = 80;

  // 하늘 환경광 (HemisphericLight)
  hemiLight = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
  hemiLight.intensity = 0.78;
  hemiLight.diffuse = new BABYLON.Color3(0.92, 0.96, 1.0);
  hemiLight.groundColor = new BABYLON.Color3(0.48, 0.50, 0.58);
  hemiLight.specular = new BABYLON.Color3(0.65, 0.68, 0.75);

  // 하늘(SkyDome)과 태양(Sun) 생성
  createSkyAndSun();

  // 구글 맵 3D 지면 생성 (기본 즉시 활성화 + 태양빛 반사 및 그림자 수신)
  ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 300, height: 300 }, scene);
  groundMaterial = new BABYLON.StandardMaterial("groundMat", scene);
  groundMaterial.diffuseTexture = createMapCanvasTexture();
  groundMaterial.specularColor = new BABYLON.Color3(0.22, 0.20, 0.16);
  groundMaterial.specularPower = 48;
  groundMaterial.maxSimultaneousLights = 6;
  ground.material = groundMaterial;
  ground.receiveShadows = true;

  guiTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");

  createCharacter();

  scene.onKeyboardObservable.add((kbInfo) => {
    const evt = kbInfo.event;
    if (kbInfo.type === BABYLON.KeyboardEventTypes.KEYDOWN) {
      inputMap[evt.key.toLowerCase()] = true;
      inputMap[evt.code] = true;
      // R키 입력 시 걷기/달리기 고정 토글
      if (!evt.repeat && (evt.code === "KeyR" || evt.key.toLowerCase() === "r" || evt.key === "ㄱ")) {
        isRunToggled = !isRunToggled;
      }
    } else if (kbInfo.type === BABYLON.KeyboardEventTypes.KEYUP) {
      inputMap[evt.key.toLowerCase()] = false;
      inputMap[evt.code] = false;
    }
  });

  scene.registerBeforeRender(() => {
    updateCharacterMovement();
    updateCameraFollow();
    updateTelemetryHUD();
  });

  return scene;
}

function updateCharacterMovement() {
  const delta = engine.getDeltaTime() / 1000;

  const isW = !!(inputMap["w"] || inputMap["KeyW"] || inputMap["ArrowUp"] || inputMap["arrowup"] || inputMap["ㅈ"]);
  const isS = !!(inputMap["s"] || inputMap["KeyS"] || inputMap["ArrowDown"] || inputMap["arrowdown"] || inputMap["ㄴ"]);
  const isA = !!(inputMap["a"] || inputMap["KeyA"] || inputMap["ArrowLeft"] || inputMap["arrowleft"] || inputMap["ㅁ"]);
  const isD = !!(inputMap["d"] || inputMap["KeyD"] || inputMap["ArrowRight"] || inputMap["arrowright"] || inputMap["ㅇ"]);
  const isShift = !!(inputMap["shift"] || inputMap["ShiftLeft"] || inputMap["ShiftRight"]);

  let inputForward = 0;
  let inputRight = 0;

  if (isW) inputForward += 1;
  if (isS) inputForward -= 1;
  if (isD) inputRight += 1;
  if (isA) inputRight -= 1;

  isMoving = inputForward !== 0 || inputRight !== 0;
  isRunning = isMoving && (isShift || isRunToggled);

  if (isMoving && camera && character) {
    // 3D 구면 좌표계 카메라가 바라보는 X-Z 수평 평면상 전방 벡터 (카메라 위치 -> 대상)
    const fwdX = -Math.cos(camera.alpha);
    const fwdZ = -Math.sin(camera.alpha);

    // 바라보는 방향의 우측(시계방향 90도) 벡터: (-sin(alpha), cos(alpha))
    const rightX = -Math.sin(camera.alpha);
    const rightZ = Math.cos(camera.alpha);

    // 카메라 시점 기준 월드 이동 방향 벡터
    let moveDirX = inputForward * fwdX + inputRight * rightX;
    let moveDirZ = inputForward * fwdZ + inputRight * rightZ;

    // 대각선 이동 시 속도 정규화
    const mag = Math.hypot(moveDirX, moveDirZ);
    if (mag > 0.0001) {
      moveDirX /= mag;
      moveDirZ /= mag;
    }

    // 캐릭터가 이동하려는 목표 방향각 (0 = +Z/북, PI/2 = +X/동)
    targetRotationY = Math.atan2(moveDirX, moveDirZ);

    let rotDiff = targetRotationY - character.rotation.y;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    character.rotation.y += rotDiff * 0.22;

    const targetMaxSpeed = isRunning ? runMaxSpeed : walkMaxSpeed;
    if (currentSpeed < targetMaxSpeed) {
      currentSpeed = Math.min(currentSpeed + 0.7, targetMaxSpeed);
    } else {
      currentSpeed = Math.max(currentSpeed - 0.7, targetMaxSpeed);
    }

    const speedUnits = (currentSpeed * METERS_PER_UNIT) * delta * 0.08;

    character.position.x += Math.sin(character.rotation.y) * speedUnits;
    character.position.z += Math.cos(character.rotation.y) * speedUnits;

    character.position.x = Math.max(-140, Math.min(140, character.position.x));
    character.position.z = Math.max(-140, Math.min(140, character.position.z));
  } else {
    currentSpeed = Math.max(currentSpeed - 0.9, 0);
  }

  // 태양 그림자 투영 중심이 항상 캐릭터 위치를 따라가도록 갱신 (맵 어디서든 고해상도 그림자 유지)
  if (dirLight && character) {
    dirLight.position.set(
      character.position.x + 18,
      26,
      character.position.z + 16
    );
  }

  // VRM 스켈레탈 애니메이션 업데이트 (Idle / Walk / Run)
  updateVRMAnimation(delta);
}

function updateCameraFollow() {
  if (!camera || !character) return;
  const targetPos = character.position.clone();
  targetPos.y += 2.2;
  BABYLON.Vector3.LerpToRef(camera.target, targetPos, 0.15, camera.target);
}

function updateTelemetryHUD() {
  if (!character) return;

  const latOffset = (character.position.z * METERS_PER_UNIT) / LAT_DEGREE_IN_METERS;
  const lngOffset = (character.position.x * METERS_PER_UNIT) / (LAT_DEGREE_IN_METERS * Math.cos(currentLocation.lat * Math.PI / 180));

  const currentLat = (currentLocation.lat + latOffset).toFixed(6);
  const currentLng = (currentLocation.lng + lngOffset).toFixed(6);

  const latEl = document.getElementById("latVal");
  const lngEl = document.getElementById("lngVal");
  const speedEl = document.getElementById("speedVal");
  const headingEl = document.getElementById("headingVal");
  const compassEl = document.getElementById("headingCompass");
  const tiltEl = document.getElementById("tiltVal");
  const motionEl = document.getElementById("motionStateVal");

  if (latEl) latEl.innerText = currentLat;
  if (lngEl) lngEl.innerText = currentLng;
  if (speedEl) speedEl.innerText = (currentSpeed * 1.2).toFixed(1);

  if (motionEl) {
    if (!isMoving) {
      motionEl.innerText = isRunToggled ? "대기 (달리기 고정)" : "대기 (Idle)";
      motionEl.className = "text-slate-300";
    } else if (isRunning) {
      motionEl.innerText = "달리기 (Run) ⚡";
      motionEl.className = "text-pink-400";
    } else {
      motionEl.innerText = "걷기 (Walk)";
      motionEl.className = "text-cyan-400";
    }
  }

  let headingDeg = Math.round((character.rotation.y * 180 / Math.PI) % 360);
  if (headingDeg < 0) headingDeg += 360;
  if (headingEl) headingEl.innerText = headingDeg;

  const directions = ["북 (N)", "북동 (NE)", "동 (E)", "남동 (SE)", "남 (S)", "남서 (SW)", "서 (W)", "북서 (NW)"];
  const dirIndex = Math.round(headingDeg / 45) % 8;
  if (compassEl) compassEl.innerText = directions[dirIndex];

  if (camera && tiltEl) {
    const tiltDeg = Math.round((camera.beta * 180) / Math.PI);
    tiltEl.innerText = tiltDeg;
  }
}

// 위치 이동 함수 (백엔드에서 POI 새로 가져옴)
async function teleportTo(locationKey) {
  const targetLoc = locationsList.find(loc => loc.id === locationKey) || locationsList[0];
  if (!targetLoc) return;

  currentLocation = { ...targetLoc };
  const locNameEl = document.getElementById("locationName");
  if (locNameEl) locNameEl.innerText = currentLocation.name;

  if (character) {
    character.position = new BABYLON.Vector3(0, 0, 0);
    character.rotation.y = 0;
  }
  if (camera) {
    camera.target = new BABYLON.Vector3(0, 2.2, 0);
  }

  // 백엔드 API에서 해당 위치의 POI 비동기 조회
  currentPois = await fetchLocationPOIs(currentLocation.id);

  // 버튼 활성화 스타일 업데이트
  updateLocationButtonsUI(locationKey);

  // 지도 텍스처 및 3D 마커 갱신
  renderMapTexture();
  rebuild3DPOIMarkers();
}

function updateLocationButtonsUI(activeId) {
  const buttons = document.querySelectorAll("#locationButtons button");
  buttons.forEach(btn => {
    const locId = btn.getAttribute("data-loc-id");
    if (locId === activeId) {
      btn.className = "px-3 py-1.5 text-xs font-medium rounded-xl bg-blue-600 hover:bg-blue-500 transition text-white border border-blue-400 shadow-md";
    } else {
      btn.className = "px-3 py-1.5 text-xs font-medium rounded-xl bg-slate-800 hover:bg-blue-600 transition text-slate-200 hover:text-white border border-slate-700";
    }
  });
}

function renderLocationButtons() {
  const container = document.getElementById("locationButtons");
  if (!container) return;
  container.innerHTML = "";

  locationsList.forEach(loc => {
    const btn = document.createElement("button");
    btn.setAttribute("data-loc-id", loc.id);
    btn.innerText = loc.name.split(" ")[1] || loc.name;
    btn.title = loc.name;
    btn.onclick = () => teleportTo(loc.id);

    if (loc.id === currentLocation.id) {
      btn.className = "px-3 py-1.5 text-xs font-medium rounded-xl bg-blue-600 hover:bg-blue-500 transition text-white border border-blue-400 shadow-md";
    } else {
      btn.className = "px-3 py-1.5 text-xs font-medium rounded-xl bg-slate-800 hover:bg-blue-600 transition text-slate-200 hover:text-white border border-slate-700";
    }

    container.appendChild(btn);
  });
}

function updateMapControlButtonsUI() {
  const lightBtn = document.getElementById("btnMapLight");
  const darkBtn = document.getElementById("btnMapDark");
  const satBtn = document.getElementById("btnMapSat");
  const poiBtn = document.getElementById("btnTogglePOI");

  const activeCls = "p-3 bg-blue-600/90 hover:bg-blue-500 backdrop-blur-md border border-blue-400 rounded-xl text-white transition shadow-lg shadow-blue-500/30 flex items-center justify-center";
  const inactiveCls = "p-3 bg-slate-900/85 hover:bg-slate-800 backdrop-blur-md border border-slate-700/60 rounded-xl text-slate-200 hover:text-white transition shadow-lg flex items-center justify-center";

  if (lightBtn) lightBtn.className = mapStyle === "light" ? activeCls : inactiveCls;
  if (darkBtn) darkBtn.className = mapStyle === "dark" ? activeCls : inactiveCls;
  if (satBtn) satBtn.className = mapStyle === "satellite" ? activeCls : inactiveCls;
  if (poiBtn) poiBtn.className = showPOIs ? activeCls : inactiveCls;
}

// 이벤트 리스너 바인딩
function setupUIEventListeners() {
  const lightBtn = document.getElementById("btnMapLight");
  const darkBtn = document.getElementById("btnMapDark");
  const satBtn = document.getElementById("btnMapSat");
  const poiBtn = document.getElementById("btnTogglePOI");
  const resetBtn = document.getElementById("btnResetCam");
  const mouseLookBtn = document.getElementById("btnToggleMouseLook");

  if (lightBtn) lightBtn.onclick = () => {
    mapStyle = 'light';
    renderMapTexture();
    renderSkyDomeTexture();
    rebuild3DPOIMarkers();
    updateMapControlButtonsUI();
  };
  if (darkBtn) darkBtn.onclick = () => {
    mapStyle = 'dark';
    renderMapTexture();
    renderSkyDomeTexture();
    rebuild3DPOIMarkers();
    updateMapControlButtonsUI();
  };
  if (satBtn) satBtn.onclick = () => {
    mapStyle = 'satellite';
    renderMapTexture();
    renderSkyDomeTexture();
    rebuild3DPOIMarkers();
    updateMapControlButtonsUI();
  };
  if (poiBtn) poiBtn.onclick = () => {
    showPOIs = !showPOIs;
    rebuild3DPOIMarkers();
    updateMapControlButtonsUI();
  };
  if (mouseLookBtn) mouseLookBtn.onclick = () => { toggleMouseLookMode(); };
  if (resetBtn) resetBtn.onclick = () => {
    if (!camera) return;
    camera.alpha = -Math.PI / 2;
    camera.beta = Math.PI / 3;
    camera.radius = 28;
  };

  updateMapControlButtonsUI();
}

// --- MOUSE CAMERA CONTROLS & POINTER LOCK ---
function setupMouseControl() {
  if (!canvas) return;

  // 우클릭 시 브라우저 기본 컨텍스트 메뉴 차단
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });

  // 캔버스 클릭 시: 마우스 룩 모드가 켜져 있다면 포인터 락(화면 중앙 마우스 고정) 진입
  canvas.addEventListener("click", () => {
    if (mouseLookEnabled && !isPointerLocked) {
      canvas.requestPointerLock();
    }
  });

  // 좌클릭(0) 또는 우클릭(2) 드래그 시작 (드래그 조작도 병행 지원)
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 0 || e.button === 2) {
      if (!isPointerLocked) {
        isPointerDragging = true;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch (_) {}
      }
    }
  });

  // 마우스 이동 시 시점 회전 (마우스 클릭 없이 마우스만 움직여도 즉시 360° 시점 회전)
  window.addEventListener("pointermove", (e) => {
    if (!camera || !mouseLookEnabled) return;

    // HUD 상단/우측 인터랙티브 요소(버튼, 링크 등) 위에 마우스가 있을 때는 버튼 클릭 편의를 위해 시점 회전 일시 정지
    const isOverHUD = e.target && (e.target.closest && e.target.closest(".pointer-events-auto"));
    if (isOverHUD && !isPointerLocked) {
      prevMouseX = null;
      prevMouseY = null;
      return;
    }

    const SENSITIVITY_X = 0.0038;
    const SENSITIVITY_Y = 0.0030;

    let dx = 0;
    let dy = 0;

    if (isPointerLocked) {
      dx = e.movementX;
      dy = e.movementY;
    } else {
      if (prevMouseX === null || prevMouseY === null) {
        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
        return;
      }
      dx = (typeof e.movementX === "number" && e.movementX !== 0) ? e.movementX : (e.clientX - prevMouseX);
      dy = (typeof e.movementY === "number" && e.movementY !== 0) ? e.movementY : (e.clientY - prevMouseY);
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    }

    // 마우스가 브라우저 창 밖에서 재진입할 때 급격한 튀김 방지
    if (Math.abs(dx) > 120 || Math.abs(dy) > 120) return;

    camera.alpha -= dx * SENSITIVITY_X;
    camera.beta -= dy * SENSITIVITY_Y;

    if (camera.beta < camera.lowerBetaLimit) camera.beta = camera.lowerBetaLimit;
    if (camera.beta > camera.upperBetaLimit) camera.beta = camera.upperBetaLimit;
  });

  const stopPointerDrag = (e) => {
    if (isPointerDragging) {
      isPointerDragging = false;
      try {
        if (e && e.pointerId && canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
    }
  };

  window.addEventListener("pointerup", stopPointerDrag);
  window.addEventListener("pointercancel", stopPointerDrag);

  // 브라우저 창 밖으로 나갈 때 좌표 초기화
  document.addEventListener("mouseleave", () => {
    prevMouseX = null;
    prevMouseY = null;
  });

  // Pointer Lock 상태 변경 감지
  document.addEventListener("pointerlockchange", () => {
    isPointerLocked = (document.pointerLockElement === canvas);
    if (isPointerLocked) {
      isPointerDragging = false;
    }
    prevMouseX = null;
    prevMouseY = null;
    updatePointerLockUI();
  });
}

function togglePointerLock() {
  if (document.pointerLockElement === canvas) {
    document.exitPointerLock();
  } else {
    canvas.requestPointerLock();
  }
}

function toggleMouseLookMode() {
  mouseLookEnabled = !mouseLookEnabled;
  if (!mouseLookEnabled && document.pointerLockElement === canvas) {
    document.exitPointerLock();
  }
  prevMouseX = null;
  prevMouseY = null;
  updatePointerLockUI();
}

function updatePointerLockUI() {
  const badge = document.getElementById("pointerLockBadge");
  const btn = document.getElementById("btnToggleMouseLook");

  if (badge) {
    if (isPointerLocked) {
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  if (btn) {
    if (mouseLookEnabled) {
      btn.className = "p-3 bg-blue-600 hover:bg-blue-500 backdrop-blur-md border border-blue-400 rounded-xl text-white transition shadow-lg shadow-blue-500/30 flex items-center justify-center";
      btn.title = "마우스 룩 (클릭 없이 시점 회전) 활성화됨 [클릭하여 끄기]";
    } else {
      btn.className = "p-3 bg-slate-900/85 hover:bg-slate-800 backdrop-blur-md border border-slate-700/60 rounded-xl text-slate-400 hover:text-white transition shadow-lg flex items-center justify-center";
      btn.title = "마우스 룩 (클릭 없이 시점 회전) 비활성화됨 [클릭하여 켜기]";
    }
  }
}

// 앱 초기화 진입점
async function initApp() {
  // Lucide 아이콘 초기화
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // 백엔드 상태 체크
  const statusEl = document.getElementById("backendStatus");
  const health = await checkServerHealth();
  if (health) {
    if (statusEl) {
      statusEl.className = "inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20";
      statusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Express 연동`;
    }
  } else {
    if (statusEl) {
      statusEl.className = "inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20";
      statusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> 오프라인 모드`;
    }
  }

  // 백엔드로부터 위치 목록 조회
  locationsList = await fetchLocations();
  if (locationsList.length > 0) {
    currentLocation = { ...locationsList[0] };
  }

  // 상단 빠른 이동 버튼 동적 렌더링
  renderLocationButtons();

  // 첫 번째 위치의 POI 목록 조회
  currentPois = await fetchLocationPOIs(currentLocation.id);

  // Babylon 엔진 및 씬 초기화
  engine = new BABYLON.Engine(canvas, true);
  createScene();
  setupMouseControl();
  rebuild3DPOIMarkers();

  // UI 이벤트 리스너 설정
  setupUIEventListeners();
  updatePointerLockUI();

  // 렌더 루프 및 리사이즈 처리
  engine.runRenderLoop(() => {
    if (scene) scene.render();
  });

  window.addEventListener("resize", () => {
    engine.resize();
  });
}

window.addEventListener("DOMContentLoaded", initApp);
