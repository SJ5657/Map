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
let engine, scene, camera;
let character, characterBody, headMesh, leftArm, rightArm, leftLeg, rightLeg;
let ground, groundMaterial, mapDynamicTexture;
let mapCanvas, mapContext;
let mapStyle = 'light'; // 'light' | 'dark' | 'satellite'
let guiTexture;
const poi3DNodes = [];
let showPOIs = true;

// Movement & Animation States
const inputMap = {};
let isMoving = false;
let currentSpeed = 0;
const maxSpeed = 14;
let targetRotationY = 0;
let animTime = 0;

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

  renderMapTexture();

  mapDynamicTexture = new BABYLON.DynamicTexture("mapDynamicTexture", mapCanvas, scene, true);
  return mapDynamicTexture;
}

function renderMapTexture() {
  if (!mapContext) return;
  const ctx = mapContext;
  const w = mapCanvas.width;
  const h = mapCanvas.height;

  // Authentic Google Maps Theme Palette
  const colors = {
    light: {
      bg: "#f8f9fa",
      block: "#e9ecef",
      park: "#e6f4ea",
      water: "#c6dafc",
      roadMajor: "#fef08a",
      roadMinor: "#ffffff",
      roadBorder: "#dadce0",
      building: "#dee2e6",
      buildingStroke: "#ced4da"
    },
    dark: {
      bg: "#171717",
      block: "#262626",
      park: "#0f291e",
      water: "#1a365d",
      roadMajor: "#854d0e",
      roadMinor: "#3b3b3b",
      roadBorder: "#262626",
      building: "#404040",
      buildingStroke: "#525252"
    },
    satellite: {
      bg: "#1c2517",
      block: "#293623",
      park: "#14380c",
      water: "#0f283d",
      roadMajor: "#64748b",
      roadMinor: "#475569",
      roadBorder: "#0f172a",
      building: "#3f4d38",
      buildingStroke: "#52634a"
    }
  }[mapStyle];

  // 1. Base Background
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, w, h);

  // 2. Water Body (Han River / Local Waters)
  ctx.fillStyle = colors.water;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.15);
  ctx.bezierCurveTo(w * 0.3, h * 0.1, w * 0.5, h * 0.35, w, h * 0.22);
  ctx.lineTo(w, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();

  // Water Text Label
  ctx.fillStyle = mapStyle === 'dark' ? "#60a5fa" : "#1a73e8";
  ctx.font = "bold 26px Roboto, 'Noto Sans KR', sans-serif";
  ctx.fillText("한강 (Han River)", w * 0.65, h * 0.12);

  // 3. Parks & Greenery
  ctx.fillStyle = colors.park;
  ctx.beginPath();
  ctx.roundRect(w * 0.15, h * 0.62, w * 0.28, h * 0.26, 32);
  ctx.fill();
  ctx.fillStyle = mapStyle === 'dark' ? "#34d399" : "#137333";
  ctx.font = "600 24px 'Noto Sans KR', sans-serif";
  ctx.fillText("🌳 도심 녹지 공원", w * 0.17, h * 0.75);

  // 4. Urban Blocks & Buildings
  ctx.fillStyle = colors.block;
  const gridSize = 160;
  const margin = 24;

  for (let x = 80; x < w - 80; x += gridSize) {
    for (let y = 80; y < h - 80; y += gridSize) {
      if (y < h * 0.25 && x < w * 0.7) continue;

      ctx.beginPath();
      ctx.roundRect(x + margin / 2, y + margin / 2, gridSize - margin, gridSize - margin, 12);
      ctx.fill();

      ctx.fillStyle = colors.building;
      ctx.strokeStyle = colors.buildingStroke;
      ctx.lineWidth = 1.5;

      const bMargin = 12;
      const bw = (gridSize - margin - bMargin * 3) / 2;
      const bh = (gridSize - margin - bMargin * 3) / 2;

      for (let bx = 0; bx < 2; bx++) {
        for (let by = 0; by < 2; by++) {
          const rx = x + margin / 2 + bMargin + bx * (bw + bMargin);
          const ry = y + margin / 2 + bMargin + by * (bh + bMargin);
          
          ctx.beginPath();
          ctx.roundRect(rx, ry, bw, bh, 6);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.fillStyle = colors.block;
    }
  }

  // 5. Road Grid
  ctx.strokeStyle = colors.roadMinor;
  ctx.lineWidth = 18;
  ctx.lineCap = "round";

  for (let x = 80; x < w; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 80; y < h; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Major Avenues
  ctx.strokeStyle = colors.roadBorder;
  ctx.lineWidth = 36;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.48);
  ctx.lineTo(w, h * 0.48);
  ctx.stroke();

  ctx.strokeStyle = colors.roadMajor;
  ctx.lineWidth = 28;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.48);
  ctx.lineTo(w, h * 0.48);
  ctx.stroke();

  // Main Vertical Avenue
  ctx.strokeStyle = colors.roadBorder;
  ctx.lineWidth = 38;
  ctx.beginPath();
  ctx.moveTo(w * 0.52, 0);
  ctx.lineTo(w * 0.52, h);
  ctx.stroke();

  ctx.strokeStyle = colors.roadMajor;
  ctx.lineWidth = 30;
  ctx.beginPath();
  ctx.moveTo(w * 0.52, 0);
  ctx.lineTo(w * 0.52, h);
  ctx.stroke();

  // Subway Route
  ctx.strokeStyle = GMAP_COLORS.subway7;
  ctx.lineWidth = 10;
  ctx.setLineDash([16, 8]);
  ctx.beginPath();
  ctx.moveTo(0, h * 0.48 + 26);
  ctx.lineTo(w, h * 0.48 + 26);
  ctx.stroke();
  ctx.setLineDash([]);

  // Crosswalks
  ctx.fillStyle = mapStyle === 'dark' ? "#64748b" : "#ffffff";
  for (let i = -40; i <= 40; i += 12) {
    ctx.fillRect(w * 0.52 + i - 4, h * 0.48 - 14, 8, 28);
  }

  // Road Name Labels
  ctx.fillStyle = mapStyle === 'dark' ? "#9ca3af" : "#5f6368";
  ctx.font = "500 22px 'Noto Sans KR', sans-serif";
  
  ctx.save();
  ctx.translate(w * 0.25, h * 0.45);
  ctx.fillText("학동로 (Hakdong-ro)", 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(w * 0.54, h * 0.35);
  ctx.rotate(Math.PI / 2);
  ctx.fillText("영동대로 (Yeongdong-daero)", 0, 0);
  ctx.restore();

  // 6. Draw POIs on Ground Texture (from backend currentPois)
  currentPois.forEach(poi => {
    const texX = ((poi.x + 150) / 300) * w;
    const texY = ((150 - poi.z) / 300) * h;

    ctx.save();
    ctx.translate(texX, texY);

    if (poi.type === "subway_exit") {
      ctx.fillStyle = poi.color || GMAP_COLORS.subway7;
      ctx.beginPath();
      ctx.roundRect(-30, -14, 60, 28, 14);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px 'Noto Sans KR', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((poi.icon || "🚪") + " 출구", 0, 0);
    } else {
      ctx.fillStyle = poi.color || GMAP_COLORS.landmark;
      ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 4;

      ctx.beginPath();
      ctx.arc(0, -14, 18, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.beginPath();
      ctx.moveTo(-10, -6);
      ctx.lineTo(0, 10);
      ctx.lineTo(10, -6);
      ctx.closePath();
      ctx.fill();

      ctx.shadowColor = "transparent";

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(poi.icon || "📍", 0, -13);

      ctx.fillStyle = mapStyle === 'dark' ? "rgba(30, 41, 59, 0.92)" : "rgba(255, 255, 255, 0.95)";
      ctx.beginPath();
      ctx.roundRect(-65, 14, 130, 26, 13);
      ctx.fill();
      ctx.strokeStyle = colors.roadBorder;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = mapStyle === 'dark' ? "#f1f5f9" : "#202124";
      ctx.font = "600 13px 'Noto Sans KR', sans-serif";
      ctx.fillText(poi.name, 0, 27);
    }

    ctx.restore();
  });

  if (mapDynamicTexture) {
    mapDynamicTexture.update();
  }
}

// --- 3D FLOATING POI BILLBOARD OVERLAYS (BABYLON GUI) ---
function rebuild3DPOIMarkers() {
  poi3DNodes.forEach(node => node.dispose());
  poi3DNodes.length = 0;

  if (!showPOIs || !guiTexture) return;

  currentPois.forEach(poi => {
    const anchor = new BABYLON.TransformNode(`poi_anchor_${poi.name}`, scene);
    anchor.position = new BABYLON.Vector3(poi.x, 3.5, poi.z);

    const container = new BABYLON.GUI.Rectangle();
    container.width = "180px";
    container.height = poi.type === "subway_exit" ? "32px" : "42px";
    container.cornerRadius = 20;
    container.color = poi.color || GMAP_COLORS.landmark;
    container.thickness = 2;
    container.background = mapStyle === 'dark' ? "rgba(15, 23, 42, 0.9)" : "rgba(255, 255, 255, 0.95)";
    container.shadowColor = "rgba(0,0,0,0.3)";
    container.shadowBlur = 8;
    container.shadowOffsetY = 4;

    const stack = new BABYLON.GUI.StackPanel();
    stack.isVertical = false;
    container.addControl(stack);

    const iconText = new BABYLON.GUI.TextBlock();
    iconText.text = (poi.icon || "📍") + " ";
    iconText.width = "30px";
    iconText.fontSize = 16;
    stack.addControl(iconText);

    const nameText = new BABYLON.GUI.TextBlock();
    nameText.text = poi.name;
    nameText.color = mapStyle === 'dark' ? "#f8fafc" : "#1e293b";
    nameText.fontSize = poi.type === "subway_exit" ? 12 : 13;
    nameText.fontWeight = "bold";
    nameText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    stack.addControl(nameText);

    guiTexture.addControl(container);
    container.linkWithMesh(anchor);
    container.linkOffsetY = -30;

    poi3DNodes.push(anchor);
    poi3DNodes.push(container);
  });
}

// --- CHARACTER CREATION ---
function createCharacter() {
  character = new BABYLON.TransformNode("character", scene);

  const bodyMat = new BABYLON.StandardMaterial("charBodyMat", scene);
  bodyMat.diffuseColor = new BABYLON.Color3(0.1, 0.5, 0.9);
  bodyMat.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);

  const jointMat = new BABYLON.StandardMaterial("charJointMat", scene);
  jointMat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.25);

  const headMat = new BABYLON.StandardMaterial("charHeadMat", scene);
  headMat.diffuseColor = new BABYLON.Color3(0.95, 0.95, 0.98);

  const visorMat = new BABYLON.StandardMaterial("charVisorMat", scene);
  visorMat.diffuseColor = new BABYLON.Color3(0.1, 0.8, 0.4);
  visorMat.emissiveColor = new BABYLON.Color3(0.05, 0.4, 0.2);

  // Torso
  characterBody = BABYLON.MeshBuilder.CreateBox("torso", { width: 1.2, height: 1.5, depth: 0.9 }, scene);
  characterBody.position.y = 1.65;
  characterBody.material = bodyMat;
  characterBody.parent = character;

  // Head
  headMesh = BABYLON.MeshBuilder.CreateBox("head", { width: 1.3, height: 1.1, depth: 1.1 }, scene);
  headMesh.position.y = 1.45;
  headMesh.material = headMat;
  headMesh.parent = characterBody;

  // Visor
  const visor = BABYLON.MeshBuilder.CreateBox("visor", { width: 0.9, height: 0.35, depth: 0.2 }, scene);
  visor.position = new BABYLON.Vector3(0, 0.05, -0.52);
  visor.material = visorMat;
  visor.parent = headMesh;

  // Arms
  leftArm = BABYLON.MeshBuilder.CreateBox("leftArm", { width: 0.35, height: 1.1, depth: 0.35 }, scene);
  leftArm.position = new BABYLON.Vector3(-0.85, 0.1, 0);
  leftArm.material = jointMat;
  leftArm.parent = characterBody;

  rightArm = BABYLON.MeshBuilder.CreateBox("rightArm", { width: 0.35, height: 1.1, depth: 0.35 }, scene);
  rightArm.position = new BABYLON.Vector3(0.85, 0.1, 0);
  rightArm.material = jointMat;
  rightArm.parent = characterBody;

  // Legs
  leftLeg = BABYLON.MeshBuilder.CreateBox("leftLeg", { width: 0.4, height: 1.0, depth: 0.4 }, scene);
  leftLeg.position = new BABYLON.Vector3(-0.35, -0.75, 0);
  leftLeg.material = jointMat;
  leftLeg.parent = characterBody;

  rightLeg = BABYLON.MeshBuilder.CreateBox("rightLeg", { width: 0.4, height: 1.0, depth: 0.4 }, scene);
  rightLeg.position = new BABYLON.Vector3(0.35, -0.75, 0);
  rightLeg.material = jointMat;
  rightLeg.parent = characterBody;

  // Shadows
  const shadowGenerator = new BABYLON.ShadowGenerator(1024, scene.lights[0]);
  shadowGenerator.addShadowCaster(characterBody, true);
  shadowGenerator.useBlurExponentialShadowMap = true;
}

// --- MAIN SCENE INITIALIZATION ---
function createScene() {
  scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.06, 0.09, 0.16, 1);

  camera = new BABYLON.ArcRotateCamera("TiltedMapCamera", -Math.PI / 2, Math.PI / 3, 40, BABYLON.Vector3.Zero(), scene);
  camera.lowerBetaLimit = Math.PI / 6;
  camera.upperBetaLimit = Math.PI / 2.5;
  camera.lowerRadiusLimit = 15;
  camera.upperRadiusLimit = 75;
  camera.attachControl(canvas, true);

  const dirLight = new BABYLON.DirectionalLight("dir01", new BABYLON.Vector3(-1, -2, -1), scene);
  dirLight.position = new BABYLON.Vector3(20, 40, 20);
  dirLight.intensity = 0.8;

  const hemiLight = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
  hemiLight.intensity = 0.6;

  ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 300, height: 300 }, scene);
  groundMaterial = new BABYLON.StandardMaterial("groundMat", scene);
  groundMaterial.diffuseTexture = createMapCanvasTexture();
  groundMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
  ground.material = groundMaterial;

  guiTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");

  createCharacter();

  scene.onKeyboardObservable.add((kbInfo) => {
    const evt = kbInfo.event;
    if (kbInfo.type === BABYLON.KeyboardEventTypes.KEYDOWN) {
      inputMap[evt.key.toLowerCase()] = true;
      inputMap[evt.code] = true;
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
  let moveX = 0;
  let moveZ = 0;

  if (inputMap["w"] || inputMap["ArrowUp"]) moveZ += 1;
  if (inputMap["s"] || inputMap["ArrowDown"]) moveZ -= 1;
  if (inputMap["a"] || inputMap["ArrowLeft"]) moveX -= 1;
  if (inputMap["d"] || inputMap["ArrowRight"]) moveX += 1;

  isMoving = moveX !== 0 || moveZ !== 0;

  if (isMoving) {
    const angle = Math.atan2(moveX, moveZ);
    const cameraAngle = camera.alpha + Math.PI / 2;
    targetRotationY = cameraAngle + angle;

    let rotDiff = targetRotationY - character.rotation.y;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    character.rotation.y += rotDiff * 0.18;

    currentSpeed = Math.min(currentSpeed + 0.5, maxSpeed);
    const delta = engine.getDeltaTime() / 1000;
    const speedUnits = (currentSpeed * METERS_PER_UNIT) * delta * 0.08;

    character.position.x += Math.sin(character.rotation.y) * speedUnits;
    character.position.z += Math.cos(character.rotation.y) * speedUnits;

    character.position.x = Math.max(-140, Math.min(140, character.position.x));
    character.position.z = Math.max(-140, Math.min(140, character.position.z));

    animTime += delta * currentSpeed * 0.8;
    leftArm.rotation.x = Math.sin(animTime) * 0.6;
    rightArm.rotation.x = -Math.sin(animTime) * 0.6;
    leftLeg.rotation.x = -Math.sin(animTime) * 0.7;
    rightLeg.rotation.x = Math.sin(animTime) * 0.7;
    characterBody.position.y = 1.65 + Math.abs(Math.sin(animTime * 2)) * 0.08;
  } else {
    currentSpeed = Math.max(currentSpeed - 0.8, 0);
    leftArm.rotation.x *= 0.8;
    rightArm.rotation.x *= 0.8;
    leftLeg.rotation.x *= 0.8;
    rightLeg.rotation.x *= 0.8;
    characterBody.position.y = 1.65;
  }
}

function updateCameraFollow() {
  if (!camera || !character) return;
  const targetPos = character.position.clone();
  targetPos.y += 1.0;
  BABYLON.Vector3.LerpToRef(camera.target, targetPos, 0.1, camera.target);
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

  if (latEl) latEl.innerText = currentLat;
  if (lngEl) lngEl.innerText = currentLng;
  if (speedEl) speedEl.innerText = (currentSpeed * 1.2).toFixed(1);

  let headingDeg = Math.round((character.rotation.y * 180 / Math.PI) % 360);
  if (headingDeg < 0) headingDeg += 360;
  if (headingEl) headingEl.innerText = headingDeg;

  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
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

// 이벤트 리스너 바인딩
function setupUIEventListeners() {
  const lightBtn = document.getElementById("btnMapLight");
  const darkBtn = document.getElementById("btnMapDark");
  const satBtn = document.getElementById("btnMapSat");
  const poiBtn = document.getElementById("btnTogglePOI");
  const resetBtn = document.getElementById("btnResetCam");

  if (lightBtn) lightBtn.onclick = () => { mapStyle = 'light'; renderMapTexture(); rebuild3DPOIMarkers(); };
  if (darkBtn) darkBtn.onclick = () => { mapStyle = 'dark'; renderMapTexture(); rebuild3DPOIMarkers(); };
  if (satBtn) satBtn.onclick = () => { mapStyle = 'satellite'; renderMapTexture(); rebuild3DPOIMarkers(); };
  if (poiBtn) poiBtn.onclick = () => { showPOIs = !showPOIs; rebuild3DPOIMarkers(); };
  if (resetBtn) resetBtn.onclick = () => {
    if (!camera) return;
    camera.alpha = -Math.PI / 2;
    camera.beta = Math.PI / 3;
    camera.radius = 40;
  };
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
  rebuild3DPOIMarkers();

  // UI 이벤트 리스너 설정
  setupUIEventListeners();

  // 렌더 루프 및 리사이즈 처리
  engine.runRenderLoop(() => {
    if (scene) scene.render();
  });

  window.addEventListener("resize", () => {
    engine.resize();
  });
}

window.addEventListener("DOMContentLoaded", initApp);
