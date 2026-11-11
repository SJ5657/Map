import { Router } from "express";
import { LOCATIONS } from "../data/locations.js";
import { POIS, GMAP_COLORS } from "../data/pois.js";

const router = Router();

// GET /api/locations - 모든 위치 목록 조회
router.get("/", (req, res) => {
  res.json({
    success: true,
    data: Object.values(LOCATIONS)
  });
});

// GET /api/locations/colors - Google 지도 스타일 색상 팔레트 조회
router.get("/colors", (req, res) => {
  res.json({
    success: true,
    data: GMAP_COLORS
  });
});

// GET /api/locations/:id - 특정 위치 정보 조회
router.get("/:id", (req, res) => {
  const { id } = req.params;
  const location = LOCATIONS[id];

  if (!location) {
    return res.status(404).json({
      success: false,
      message: `위치 ID '${id}'을(를) 찾을 수 없습니다.`
    });
  }

  res.json({
    success: true,
    data: location
  });
});

// GET /api/locations/:id/pois - 특정 위치의 POI 목록 조회
router.get("/:id/pois", (req, res) => {
  const { id } = req.params;
  const location = LOCATIONS[id];

  if (!location) {
    return res.status(404).json({
      success: false,
      message: `위치 ID '${id}'을(를) 찾을 수 없습니다.`
    });
  }

  const pois = POIS[id] || [];
  res.json({
    success: true,
    location: location.name,
    count: pois.length,
    data: pois
  });
});

// POST /api/locations/:id/pois - 특정 위치에 새로운 POI 추가
router.post("/:id/pois", (req, res) => {
  const { id } = req.params;
  const location = LOCATIONS[id];

  if (!location) {
    return res.status(404).json({
      success: false,
      message: `위치 ID '${id}'을(를) 찾을 수 없습니다.`
    });
  }

  const { name, type, color, x, z, icon, line } = req.body;
  if (!name || x === undefined || z === undefined) {
    return res.status(400).json({
      success: false,
      message: "POI 이름(name)과 좌표(x, z)는 필수 입력 항목입니다."
    });
  }

  if (!POIS[id]) {
    POIS[id] = [];
  }

  const newPOI = {
    id: `${id}_poi_${Date.now()}`,
    name,
    type: type || "landmark",
    color: color || GMAP_COLORS.landmark,
    x: Number(x),
    z: Number(z),
    icon: icon || "📍",
    ...(line ? { line } : {})
  };

  POIS[id].push(newPOI);

  res.status(201).json({
    success: true,
    message: "새 POI가 성공적으로 등록되었습니다.",
    data: newPOI
  });
});

export default router;
