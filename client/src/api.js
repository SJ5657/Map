/**
 * 백엔드 Express API 통신 헬퍼 모듈
 */

const API_BASE = "/api";

// 오프라인 fallback 데이터
const FALLBACK_LOCATIONS = [
  { id: "cheongdam", name: "서울 강남구 청담역 (7호선)", lat: 37.519200, lng: 127.053100 },
  { id: "gangnam", name: "서울 강남대로 (강남역)", lat: 37.497900, lng: 127.027600 },
  { id: "shibuya", name: "도쿄 시부야 스크램블", lat: 35.659500, lng: 139.700400 },
  { id: "timesSquare", name: "뉴욕 타임스퀘어", lat: 40.758000, lng: -73.985500 }
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
