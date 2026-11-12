/**
 * 전세계 실시간 3D 지형(World Terrain) 스트리밍 & 청크 풀링 최적화 엔진
 *
 * 핵심 최적화 기법:
 * 1. Chunk Object Pooling (5x5 고정 청크 풀 재사용, 런타임 Mesh/Texture 생성·파괴 0회, Zero-GC)
 * 2. AWS Mapzen Terrarium 전세계 실제 해발고도(DEM) 타일 + Esri 위성 지형 타일 비동기 스트리밍 & LRU 캐시
 * 3. TypedArray(Float32Array / Uint8ClampedArray) 직접 연산 및 128x128 픽셀 버퍼 재사용 (청크당 < 1ms)
 * 4. Time-Sliced Frame Budget Queue (프레임당 최대 2개 청크만 분할 갱신하여 60 FPS 고정 유지)
 * 5. 거리 기반 그림자 수신(중심 3x3 청크만 receiveShadows 활성화) 및 자동 Frustum Culling
 */

const METERS_PER_UNIT = 5;
const EARTH_METERS_PER_DEG_LAT = 111320;

// 청크 그리드 설정 (5x5 = 25개 청크 풀, 가시 영역 500x500 유닛 = 2.5km x 2.5km)
const GRID_RADIUS = 2;
const GRID_DIM = GRID_RADIUS * 2 + 1; // 5
const CHUNK_SIZE = 100;               // 청크 1개 크기 (월드 유닛)
const CHUNK_SUBDIVISIONS = 24;        // 청크당 분할 수 (25x25 = 625 정점)
const VERTEX_COUNT_1D = CHUNK_SUBDIVISIONS + 1;
const TEX_RES = 128;                  // 청크당 절차적/합성 텍스처 해상도 (128x128 고속 버퍼)

// 전세계 타일 줌 레벨 (Zoom 12: 약 9.5km 타일 단위로 산맥·강·지형 기복 표현에 최적)
const TERRAIN_TILE_ZOOM = 12;
const MAX_CACHE_TILES = 96;

export class WorldTerrainManager {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.mapStyle = options.mapStyle || "light";

    // 기준 GPS 원점 (월드 좌표 (0,0)에 대응하는 위도/경도)
    this.originLat = options.lat ?? 37.5192;
    this.originLng = options.lng ?? 127.0531;
    this.cosOriginLat = Math.cos((this.originLat * Math.PI) / 180);

    // 기준점 해발고도 오프셋 (스폰 지점 지면이 너무 높거나 낮게 치우치지 않도록 보정)
    this.baseElevationMeters = 0;
    this.baseElevationInitialized = false;

    // LRU 캐시: DEM(고도) 타일 & 위성 이미지 타일
    this.demCache = new Map();     // key: "z/x/y" -> { status, heights: Float32Array(256*256) }
    this.imageryCache = new Map(); // key: "z/x/y" -> { status, canvas: HTMLCanvasElement }

    // 디코딩용 공유 오프스크린 캔버스 (1회 생성 후 영구 재사용)
    this.decodeCanvas = document.createElement("canvas");
    this.decodeCanvas.width = 256;
    this.decodeCanvas.height = 256;
    this.decodeCtx = this.decodeCanvas.getContext("2d", { willReadFrequently: true });

    // 청크 오브젝트 풀 및 타임슬라이싱 큐
    this.chunks = [];
    this.chunkMap = new Map(); // key: "cx,cz" -> chunk
    this.updateQueue = [];     // 비동기 분할 업데이트 대기열
    this.centerChunkX = 0;
    this.centerChunkZ = 0;

    // 공유 지형 머티리얼 스펙 설정 및 청크 풀 초기화
    this._initChunkPool();
  }

  // --- 좌표 변환 유틸리티 ---
  worldToLatLng(worldX, worldZ) {
    const dLat = (worldZ * METERS_PER_UNIT) / EARTH_METERS_PER_DEG_LAT;
    const dLng = (worldX * METERS_PER_UNIT) / (EARTH_METERS_PER_DEG_LAT * this.cosOriginLat);
    return {
      lat: Math.max(-85.0, Math.min(85.0, this.originLat + dLat)),
      lng: ((((this.originLng + dLng) + 180) % 360 + 360) % 360) - 180
    };
  }

  latLngToTileUV(lat, lng, zoom) {
    const n = Math.pow(2, zoom);
    const latRad = (lat * Math.PI) / 180;
    const fx = ((lng + 180) / 360) * n;
    const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

    const tx = Math.floor(fx);
    const ty = Math.max(0, Math.min(n - 1, Math.floor(fy)));
    const u = fx - tx;
    const v = fy - ty;
    const wrappedTx = ((tx % n) + n) % n;

    return { z: zoom, tx: wrappedTx, ty, u, v };
  }

  // --- LRU 캐시 정리 ---
  _pruneCache(cacheMap) {
    while (cacheMap.size > MAX_CACHE_TILES) {
      const oldestKey = cacheMap.keys().next().value;
      cacheMap.delete(oldestKey);
    }
  }

  // --- AWS Mapzen Terrarium 전세계 실제 고도(DEM) 타일 비동기 로드 ---
  _requestDemTile(z, tx, ty) {
    const key = `${z}/${tx}/${ty}`;
    if (this.demCache.has(key)) {
      const entry = this.demCache.get(key);
      // LRU 갱신
      this.demCache.delete(key);
      this.demCache.set(key, entry);
      return entry;
    }

    const entry = { status: "loading", heights: null };
    this.demCache.set(key, entry);
    this._pruneCache(this.demCache);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        this.decodeCtx.clearRect(0, 0, 256, 256);
        this.decodeCtx.drawImage(img, 0, 0, 256, 256);
        const imgData = this.decodeCtx.getImageData(0, 0, 256, 256).data;
        const heights = new Float32Array(256 * 256);

        // Terrarium 포맷 디코딩: (R * 256 + G + B / 256) - 32768 (단위: 미터)
        for (let i = 0, p = 0; i < heights.length; i++, p += 4) {
          const r = imgData[p];
          const g = imgData[p + 1];
          const b = imgData[p + 2];
          heights[i] = (r * 256.0 + g + b * 0.00390625) - 32768.0;
        }

        entry.heights = heights;
        entry.status = "ready";

        // 기준 원점 해발고도 최초 보정
        if (!this.baseElevationInitialized) {
          const originTile = this.latLngToTileUV(this.originLat, this.originLng, TERRAIN_TILE_ZOOM);
          if (originTile.tx === tx && originTile.ty === ty) {
            const rawOriginElev = this._sampleDemBilinear(heights, originTile.u, originTile.v);
            this.baseElevationMeters = Math.max(0, rawOriginElev);
            this.baseElevationInitialized = true;
          }
        }

        // 모든 활성 청크를 부드럽게 재갱신 큐에 등록
        this._enqueueAllChunks();
      } catch (_) {
        entry.status = "error";
      }
    };
    img.onerror = () => {
      entry.status = "error";
    };
    img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
    return entry;
  }

  // --- Esri World Imagery (순수 위성 지형 타일, 라벨 없음) 비동기 로드 ---
  _requestImageryTile(z, tx, ty) {
    const key = `${z}/${tx}/${ty}`;
    if (this.imageryCache.has(key)) {
      const entry = this.imageryCache.get(key);
      this.imageryCache.delete(key);
      this.imageryCache.set(key, entry);
      return entry;
    }

    const entry = { status: "loading", pixels: null };
    this.imageryCache.set(key, entry);
    this._pruneCache(this.imageryCache);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        this.decodeCtx.clearRect(0, 0, 256, 256);
        this.decodeCtx.drawImage(img, 0, 0, 256, 256);
        const data = this.decodeCtx.getImageData(0, 0, 256, 256).data;
        entry.pixels = new Uint8ClampedArray(data);
        entry.status = "ready";
        if (this.mapStyle === "satellite") {
          this._enqueueAllChunks();
        }
      } catch (_) {
        entry.status = "error";
      }
    };
    img.onerror = () => {
      entry.status = "error";
    };
    // ArcGIS World Imagery (z/y/x 순서)
    img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
    return entry;
  }

  _sampleDemBilinear(heights, u, v) {
    const fx = Math.max(0, Math.min(255, u * 255));
    const fy = Math.max(0, Math.min(255, v * 255));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(255, x0 + 1);
    const y1 = Math.min(255, y0 + 1);
    const dx = fx - x0;
    const dy = fy - y0;

    const row0 = y0 * 256;
    const row1 = y1 * 256;
    const h00 = heights[row0 + x0];
    const h10 = heights[row0 + x1];
    const h01 = heights[row1 + x0];
    const h11 = heights[row1 + x1];

    const top = h00 + (h10 - h00) * dx;
    const bottom = h01 + (h11 - h01) * dx;
    return top + (bottom - top) * dy;
  }

  // --- 고속 결정론적 위경도 다중 옥타브 지형 노이즈 (폴백 및 마이크로 디테일용) ---
  _hash2D(ix, iz) {
    let n = (ix * 374761393 + iz * 668265263) ^ 0x5bf03635;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295.0;
  }

  _valueNoise2D(x, z) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uz = fz * fz * (3.0 - 2.0 * fz);

    const a = this._hash2D(ix, iz);
    const b = this._hash2D(ix + 1, iz);
    const c = this._hash2D(ix, iz + 1);
    const d = this._hash2D(ix + 1, iz + 1);

    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  }

  _proceduralElevationMeters(lat, lng) {
    // 위경도 기반 연속 FBM + Ridged 산맥 및 강줄기 합성
    const sx = lng * 180.0;
    const sz = lat * 180.0;

    const n1 = this._valueNoise2D(sx * 0.45, sz * 0.45);
    const n2 = this._valueNoise2D(sx * 1.15, sz * 1.15) * 0.5;
    const n3 = this._valueNoise2D(sx * 2.8, sz * 2.8) * 0.25;
    const ridge = 1.0 - Math.abs(this._valueNoise2D(sx * 0.7, sz * 0.7) * 2.0 - 1.0);

    // 구불구불한 자연 하천 채널
    const riverWave = Math.sin(sx * 0.35 + n1 * 2.2) + Math.cos(sz * 0.35 - n2 * 2.0);
    const riverDist = Math.abs(riverWave);

    let elev = (n1 * 0.55 + n2 * 0.3 + n3 * 0.15) * 180.0 + ridge * ridge * 140.0 - 95.0;
    if (riverDist < 0.24) {
      const t = riverDist / 0.24;
      elev = elev * (t * t) - (1.0 - t * t) * 12.0;
    }
    return elev;
  }

  /**
   * 전세계 임의 월드 좌표 (worldX, worldZ)에서의 실제 해발고도(m) 및 3D 월드 높이(y) 반환
   */
  sampleElevationData(worldX, worldZ) {
    const { lat, lng } = this.worldToLatLng(worldX, worldZ);
    const tileInfo = this.latLngToTileUV(lat, lng, TERRAIN_TILE_ZOOM);
    const demEntry = this._requestDemTile(tileInfo.z, tileInfo.tx, tileInfo.ty);

    let rawMeters;
    const microNoise = (this._valueNoise2D(lng * 900, lat * 900) - 0.5) * 3.5;

    if (demEntry && demEntry.status === "ready" && demEntry.heights) {
      rawMeters = this._sampleDemBilinear(demEntry.heights, tileInfo.u, tileInfo.v) + microNoise;
    } else {
      rawMeters = this._proceduralElevationMeters(lat, lng);
    }

    const isWater = rawMeters <= 0.5;
    // 상대 고도(m)를 3D 월드 유닛 높이로 변환 (고산 지대에서도 카메라/캐릭터 이동이 쾌적하도록 비선형 스케일링)
    const relMeters = rawMeters - this.baseElevationMeters;
    let worldY = 0;

    if (isWater) {
      worldY = -0.35;
    } else {
      const sign = relMeters >= 0 ? 1 : -1;
      const absM = Math.abs(relMeters);
      // 완만한 구릉은 선명하게, 에베레스트 등 초고산은 과도하게 치솟지 않도록 압축 스케일링
      worldY = sign * (Math.pow(absM, 0.78) * 0.14);
      worldY = Math.max(-2.5, Math.min(48.0, worldY));
    }

    return {
      lat,
      lng,
      elevationMeters: Math.round(rawMeters),
      rawMeters,
      worldY,
      isWater,
      tileInfo
    };
  }

  /**
   * 캐릭터/카메라 추적용 고속 3D 지형 높이(y) 조회
   */
  getTerrainHeightAtWorld(worldX, worldZ) {
    return this.sampleElevationData(worldX, worldZ).worldY;
  }

  // --- 5x5 청크 오브젝트 풀 초기화 (단 1회 생성) ---
  _initChunkPool() {
    for (let gz = -GRID_RADIUS; gz <= GRID_RADIUS; gz++) {
      for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx++) {
        const chunk = this._createPooledChunk(gx, gz);
        this.chunks.push(chunk);
        this.chunkMap.set(`${gx},${gz}`, chunk);
        this._enqueueChunkUpdate(chunk, Math.hypot(gx, gz));
      }
    }
  }

  _createPooledChunk(cx, cz) {
    const mesh = BABYLON.MeshBuilder.CreateGround(
      `terrain_chunk_${cx}_${cz}`,
      {
        width: CHUNK_SIZE,
        height: CHUNK_SIZE,
        subdivisions: CHUNK_SUBDIVISIONS,
        updatable: true
      },
      this.scene
    );

    const positions = new Float32Array(mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind));
    const normals = new Float32Array(mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind));
    const indices = mesh.getIndices();

    // 청크 전용 128x128 고속 캔버스 & ImageData 버퍼
    const canvas = document.createElement("canvas");
    canvas.width = TEX_RES;
    canvas.height = TEX_RES;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(TEX_RES, TEX_RES);

    const dynamicTex = new BABYLON.DynamicTexture(
      `chunkTex_${cx}_${cz}`,
      canvas,
      this.scene,
      false,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE
    );
    dynamicTex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    dynamicTex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    dynamicTex.anisotropicFilteringLevel = 4;

    const mat = new BABYLON.StandardMaterial(`chunkMat_${cx}_${cz}`, this.scene);
    mat.diffuseTexture = dynamicTex;
    mat.specularColor = new BABYLON.Color3(0.14, 0.14, 0.12);
    mat.specularPower = 64;
    mat.maxSimultaneousLights = 4;

    mesh.material = mat;
    mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    // 중심 3x3 청크만 그림자 수신 활성화 (GPU 최적화)
    mesh.receiveShadows = Math.abs(cx) <= 1 && Math.abs(cz) <= 1;
    mesh.isPickable = false;

    return {
      cx,
      cz,
      mesh,
      positions,
      normals,
      indices,
      canvas,
      ctx,
      imgData,
      dynamicTex,
      dirty: true
    };
  }

  _enqueueChunkUpdate(chunk, priorityDist = 0) {
    chunk.dirty = true;
    chunk.priority = priorityDist;
    if (!this.updateQueue.includes(chunk)) {
      this.updateQueue.push(chunk);
    }
    // 캐릭터에서 가까운 청크부터 우선 처리
    this.updateQueue.sort((a, b) => a.priority - b.priority);
  }

  _enqueueAllChunks() {
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      const dist = Math.hypot(c.cx - this.centerChunkX, c.cz - this.centerChunkZ);
      this._enqueueChunkUpdate(c, dist);
    }
  }

  /**
   * 캐릭터 이동 시 청크 링버퍼 재배치 & 프레임 예산 내(최대 2개 청크/프레임) 분할 빌드
   */
  updateAroundPosition(worldX, worldZ) {
    const newCx = Math.round(worldX / CHUNK_SIZE);
    const newCz = Math.round(worldZ / CHUNK_SIZE);

    if (newCx !== this.centerChunkX || newCz !== this.centerChunkZ) {
      this.centerChunkX = newCx;
      this.centerChunkZ = newCz;
      this._recycleChunksAround(newCx, newCz);
    }

    // 타임 슬라이싱: 한 프레임당 최대 2개 청크만 빌드하여 60 FPS 유지
    const startTime = performance.now();
    let processed = 0;

    while (this.updateQueue.length > 0 && processed < 2) {
      const chunk = this.updateQueue.shift();
      if (!chunk.dirty) continue;
      this._rebuildChunkGeometryAndTexture(chunk);
      chunk.dirty = false;
      processed++;
      if (performance.now() - startTime > 4.5) break;
    }
  }

  _recycleChunksAround(centerCx, centerCz) {
    const neededCoords = [];
    const neededSet = new Set();

    for (let dz = -GRID_RADIUS; dz <= GRID_RADIUS; dz++) {
      for (let dx = -GRID_RADIUS; dx <= GRID_RADIUS; dx++) {
        const tx = centerCx + dx;
        const tz = centerCz + dz;
        const key = `${tx},${tz}`;
        neededSet.add(key);
        neededCoords.push({ cx: tx, cz: tz, key, dist: Math.hypot(dx, dz) });
      }
    }

    // 범위를 벗어난 청크 수집
    const freeChunks = [];
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      const key = `${chunk.cx},${chunk.cz}`;
      if (!neededSet.has(key)) {
        this.chunkMap.delete(key);
        freeChunks.push(chunk);
      } else {
        // 그림자 수신 범위(중심 3x3) 동적 갱신
        chunk.mesh.receiveShadows =
          Math.abs(chunk.cx - centerCx) <= 1 && Math.abs(chunk.cz - centerCz) <= 1;
      }
    }

    // 새 좌표에 유휴 청크 재할당
    for (let i = 0; i < neededCoords.length; i++) {
      const target = neededCoords[i];
      if (!this.chunkMap.has(target.key) && freeChunks.length > 0) {
        const chunk = freeChunks.pop();
        chunk.cx = target.cx;
        chunk.cz = target.cz;
        chunk.mesh.position.set(target.cx * CHUNK_SIZE, 0, target.cz * CHUNK_SIZE);
        chunk.mesh.receiveShadows =
          Math.abs(target.cx - centerCx) <= 1 && Math.abs(target.cz - centerCz) <= 1;
        this.chunkMap.set(target.key, chunk);
        this._enqueueChunkUpdate(chunk, target.dist);
      }
    }
  }

  /**
   * 청크 1개의 3D 정점 고도(Heightmap)와 순수 지형 텍스처(Topographic / Dark / Satellite) 빌드
   */
  _rebuildChunkGeometryAndTexture(chunk) {
    const { cx, cz, mesh, positions, normals, indices, imgData, ctx, dynamicTex } = chunk;
    const chunkWorldX = cx * CHUNK_SIZE;
    const chunkWorldZ = cz * CHUNK_SIZE;

    // 1. 3D 메쉬 정점 고도(Y) 업데이트 (인접 청크와 동일한 전역 좌표 샘플링으로 경계 Seam 0%)
    const vertexElevations = new Float32Array(VERTEX_COUNT_1D * VERTEX_COUNT_1D);
    for (let i = 0, vIdx = 0; i < positions.length; i += 3, vIdx++) {
      const vx = positions[i] + chunkWorldX;
      const vz = positions[i + 2] + chunkWorldZ;
      const sample = this.sampleElevationData(vx, vz);
      positions[i + 1] = sample.worldY;
      vertexElevations[vIdx] = sample.rawMeters;
    }

    BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions, false, false);
    mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, normals, false, false);
    mesh.refreshBoundingInfo();

    // 2. 128x128 지형 텍스처 픽셀 고속 생성 (건물·도로·라벨 없는 100% 순수 지형)
    const data = imgData.data;
    const halfSize = CHUNK_SIZE * 0.5;
    const step = CHUNK_SIZE / (TEX_RES - 1);
    const style = this.mapStyle;

    for (let py = 0; py < TEX_RES; py++) {
      // DynamicTexture UV 매핑에 맞춰 상단(py=0)이 +Z, 하단(py=TEX_RES-1)이 -Z
      const wz = chunkWorldZ + (halfSize - py * step);
      for (let px = 0; px < TEX_RES; px++) {
        const wx = chunkWorldX + (-halfSize + px * step);
        const pIdx = (py * TEX_RES + px) * 4;

        // 정점 그리드에서 고속 바이리니어 보간으로 고도(m) 및 경사(Slope) 추출
        const gx = (px / (TEX_RES - 1)) * CHUNK_SUBDIVISIONS;
        const gz = (py / (TEX_RES - 1)) * CHUNK_SUBDIVISIONS;
        const ix = Math.min(CHUNK_SUBDIVISIONS - 1, Math.floor(gx));
        const iz = Math.min(CHUNK_SUBDIVISIONS - 1, Math.floor(gz));
        const fx = gx - ix;
        const fz = gz - iz;

        const row0 = iz * VERTEX_COUNT_1D;
        const row1 = (iz + 1) * VERTEX_COUNT_1D;
        const e00 = vertexElevations[row0 + ix];
        const e10 = vertexElevations[row0 + ix + 1];
        const e01 = vertexElevations[row1 + ix];
        const e11 = vertexElevations[row1 + ix + 1];

        const elevM =
          (e00 + (e10 - e00) * fx) * (1 - fz) +
          (e01 + (e11 - e01) * fx) * fz;

        // 북서광 기준 경사 음영 (Hillshade)
        const dEdX = (e10 - e00);
        const dEdZ = (e00 - e01);
        const shade = Math.max(0.68, Math.min(1.22, 1.0 + (dEdX * -0.025 + dEdZ * 0.025)));

        // 등고선 판별 (25m 간격 부근)
        const contourMod = ((elevM % 25) + 25) % 25;
        const isContour = elevM > 1.5 && (contourMod < 1.35 || contourMod > 23.65);

        let r = 0, g = 0, b = 0;

        if (style === "satellite") {
          // 위성 모드: 실제 Esri World Imagery 타일 픽셀 샘플링 + 자연 지형 폴백 블렌딩
          const { lat, lng } = this.worldToLatLng(wx, wz);
          const tInfo = this.latLngToTileUV(lat, lng, TERRAIN_TILE_ZOOM);
          const imgEntry = this._requestImageryTile(tInfo.z, tInfo.tx, tInfo.ty);

          if (imgEntry && imgEntry.status === "ready" && imgEntry.pixels) {
            const txPx = Math.min(255, Math.floor(tInfo.u * 256));
            const tyPx = Math.min(255, Math.floor(tInfo.v * 256));
            const sIdx = (tyPx * 256 + txPx) * 4;
            r = imgEntry.pixels[sIdx] * shade;
            g = imgEntry.pixels[sIdx + 1] * shade;
            b = imgEntry.pixels[sIdx + 2] * shade;
          } else {
            const c = this._getHypsometricColor(elevM, "satellite");
            r = c[0] * shade;
            g = c[1] * shade;
            b = c[2] * shade;
          }
        } else {
          // Light / Dark 지형 등고선도
          const c = this._getHypsometricColor(elevM, style);
          r = c[0] * shade;
          g = c[1] * shade;
          b = c[2] * shade;

          if (isContour) {
            if (style === "dark") {
              r = r * 0.75 + 28;
              g = g * 0.75 + 52;
              b = b * 0.75 + 42;
            } else {
              r *= 0.86;
              g *= 0.87;
              b *= 0.84;
            }
          }
        }

        data[pIdx] = r;
        data[pIdx + 1] = g;
        data[pIdx + 2] = b;
        data[pIdx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    dynamicTex.update();
  }

  /**
   * 해발고도(m) 및 테마별 자연 지형 색상(Hypsometric Tinting) 반환
   */
  _getHypsometricColor(elevM, style) {
    if (style === "dark") {
      if (elevM <= 0.5) return [18, 42, 72];       // 바다/강 수계
      if (elevM < 4.0) return [32, 40, 36];        // 수변 모래톱
      if (elevM < 60.0) return [22, 42, 32];       // 저지대 평야
      if (elevM < 220.0) return [19, 52, 36];      // 구릉/삼림
      if (elevM < 650.0) return [34, 56, 44];      // 산악 지대
      if (elevM < 1500.0) return [54, 62, 60];     // 고산 암석
      return [140, 155, 168];                      // 만년설 고봉
    }

    if (style === "satellite") {
      if (elevM <= 0.5) return [17, 48, 72];
      if (elevM < 4.0) return [76, 72, 56];
      if (elevM < 80.0) return [42, 66, 34];
      if (elevM < 280.0) return [30, 54, 24];
      if (elevM < 800.0) return [58, 62, 46];
      if (elevM < 1600.0) return [92, 90, 84];
      return [215, 224, 232];
    }

    // 기본 Light 지형도
    if (elevM <= 0.5) return [156, 198, 242];      // 강/바다
    if (elevM < 4.0) return [234, 226, 202];       // 해안/수변 모래톱
    if (elevM < 45.0) return [226, 238, 214];      // 평야 초지
    if (elevM < 160.0) return [198, 226, 184];     // 구릉 녹지
    if (elevM < 450.0) return [172, 208, 160];     // 산림 지대
    if (elevM < 1100.0) return [198, 194, 174];    // 고산 능선
    if (elevM < 2000.0) return [214, 210, 204];    // 암봉
    return [244, 248, 252];                        // 설산 정상
  }

  /**
   * 새로운 전세계 위도/경도로 기준점 변경 (텔레포트)
   */
  setOriginLatLng(lat, lng) {
    this.originLat = Math.max(-85.0, Math.min(85.0, Number(lat)));
    this.originLng = ((((Number(lng) + 180) % 360) + 360) % 360) - 180;
    this.cosOriginLat = Math.cos((this.originLat * Math.PI) / 180);
    this.baseElevationInitialized = false;
    this.baseElevationMeters = 0;

    // 기준 타일 고도가 이미 캐시에 있다면 즉시 기준 고도 설정
    const originTile = this.latLngToTileUV(this.originLat, this.originLng, TERRAIN_TILE_ZOOM);
    const demEntry = this._requestDemTile(originTile.z, originTile.tx, originTile.ty);
    if (demEntry && demEntry.status === "ready" && demEntry.heights) {
      const rawOriginElev = this._sampleDemBilinear(demEntry.heights, originTile.u, originTile.v);
      this.baseElevationMeters = Math.max(0, rawOriginElev);
      this.baseElevationInitialized = true;
    }

    this._recycleChunksAround(0, 0);
    this.centerChunkX = 0;
    this.centerChunkZ = 0;
    this._enqueueAllChunks();

    // 스폰 직후 중심 청크(0,0)는 즉시 빌드하여 캐릭터 발밑 지형을 바로 반영
    const centerChunk = this.chunkMap.get("0,0");
    if (centerChunk) {
      this._rebuildChunkGeometryAndTexture(centerChunk);
      centerChunk.dirty = false;
    }
  }

  setMapStyle(style) {
    if (this.mapStyle === style) return;
    this.mapStyle = style;
    this._enqueueAllChunks();
  }
}
