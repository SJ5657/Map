/**
 * 백엔드 Express API 통신 헬퍼 모듈
 */

const API_BASE = "/api";

// 오프라인 fallback 데이터
const FALLBACK_LOCATIONS = [
  { id: "cheongdam", name: "한국 서울 (한강·청담 지형)", lat: 37.519200, lng: 127.053100 },
  { id: "hallasan", name: "한국 제주 (한라산 화산지형)", lat: 33.361700, lng: 126.529200 },
  { id: "fujisan", name: "일본 시즈오카 (후지산)", lat: 35.360600, lng: 138.727400 },
  { id: "matterhorn", name: "스위스 알프스 (마테호른)", lat: 45.976300, lng: 7.658600 },
  { id: "grandCanyon", name: "미국 애리조나 (그랜드 캐니언)", lat: 36.054400, lng: -112.140100 },
  { id: "everest", name: "네팔 히말라야 (에베레스트)", lat: 27.988100, lng: 86.925000 }
];

export async function checkServerHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("[API] 서버 헬스체크 실패 (백엔드 오프라인 모드):", err.message);
    return null;
  }
}

export async function fetchLocations() {
  try {
    const res = await fetch(`${API_BASE}/locations`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.data;
  } catch (err) {
    console.warn("[API] 위치 목록 조회 실패, 로컬 캐시를 사용합니다:", err.message);
    return FALLBACK_LOCATIONS;
  }
}

export async function fetchLocationPOIs(locationId) {
  try {
    const res = await fetch(`${API_BASE}/locations/${locationId}/pois`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.data;
  } catch (err) {
    console.warn(`[API] POI 목록 조회 실패 (${locationId}):`, err.message);
    return [];
  }
}

export async function createPOI(locationId, poiData) {
  try {
    const res = await fetch(`${API_BASE}/locations/${locationId}/pois`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(poiData)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("[API] POI 등록 실패:", err.message);
    throw err;
  }
}
