export const GMAP_COLORS = {
  subway7: "#747F00",   // Line 7 Olive Green
  subway2: "#2DB400",   // Line 2 Green
  subway9: "#BDB092",   // Line 9 Gold/Beige
  subwayShin: "#D4003B",// Shinbundang Red
  hospital: "#EA4335",  // Google Medical Red
  shopping: "#F29900",  // Google Shopping Orange
  food: "#E65100",      // Google Dining Deep Orange
  landmark: "#1A73E8",  // Google Blue
  park: "#137333",      // Google Forest Green
  transit: "#0070C0"    // Transit Icon Blue
};

export const POIS = {
  cheongdam: [
    { id: "c1", name: "청담역 7호선", type: "subway", line: "7호선", color: GMAP_COLORS.subway7, x: 0, z: 0, icon: "🚇" },
    { id: "c2", name: "청담역 1번출구", type: "subway_exit", line: "7호선 1번", color: GMAP_COLORS.subway7, x: 18, z: 12, icon: "1️⃣" },
    { id: "c3", name: "청담역 7번출구", type: "subway_exit", line: "7호선 7번", color: GMAP_COLORS.subway7, x: -22, z: 15, icon: "7️⃣" },
    { id: "c4", name: "청담역 13번출구", type: "subway_exit", line: "7호선 13번", color: GMAP_COLORS.subway7, x: 28, z: -25, icon: "⑬" },
    { id: "c5", name: "청담 우리들병원", type: "hospital", color: GMAP_COLORS.hospital, x: -45, z: 35, icon: "🏥" },
    { id: "c6", name: "강남세브란스 청담검진센터", type: "hospital", color: GMAP_COLORS.hospital, x: -70, z: 60, icon: "🩺" },
    { id: "c7", name: "강남구청역 (7호선/수인분당)", type: "subway", line: "환승역", color: GMAP_COLORS.subway7, x: -90, z: 10, icon: "🚉" },
    { id: "c8", name: "청담동 명품거리", type: "store", color: GMAP_COLORS.shopping, x: 45, z: 65, icon: "🛍️" },
    { id: "c9", name: "SM ENTERTAINMENT HQ", type: "landmark", color: GMAP_COLORS.landmark, x: 65, z: -40, icon: "🏢" },
    { id: "c10", name: "청담공원", type: "park", color: GMAP_COLORS.park, x: -35, z: -55, icon: "🌳" },
    { id: "c11", name: "스타벅스 청담역점", type: "cafe", color: GMAP_COLORS.food, x: -15, z: 22, icon: "☕" },
    { id: "c12", name: "청담동 주민센터 버스정류장", type: "bus", color: GMAP_COLORS.transit, x: 35, z: 5, icon: "🚌" }
  ],
  gangnam: [
    { id: "g1", name: "강남역 2호선", type: "subway", line: "2호선", color: GMAP_COLORS.subway2, x: 0, z: 20, icon: "🚇" },
    { id: "g2", name: "강남역 신분당선", type: "subway", line: "신분당", color: GMAP_COLORS.subwayShin, x: 15, z: -25, icon: "🚇" },
    { id: "g3", name: "강남세브란스 협력병원", type: "hospital", color: GMAP_COLORS.hospital, x: -50, z: 45, icon: "🏥" },
    { id: "g4", name: "카카오프렌즈 강남플래그십", type: "store", color: GMAP_COLORS.shopping, x: -20, z: -10, icon: "🛍️" },
    { id: "g5", name: "스타벅스 강남대로점", type: "cafe", color: GMAP_COLORS.food, x: 35, z: 30, icon: "☕" }
  ],
  shibuya: [
    { id: "s1", name: "시부야역 (JR Yamanote)", type: "subway", line: "JY", color: "#80C242", x: -10, z: 10, icon: "🚉" },
    { id: "s2", name: "시부야 스크램블 교차로", type: "landmark", color: GMAP_COLORS.landmark, x: 10, z: -15, icon: "🚦" },
    { id: "s3", name: "시부야 적십자 종합병원", type: "hospital", color: GMAP_COLORS.hospital, x: -60, z: 50, icon: "🏥" },
    { id: "s4", name: "시부야 109 타워", type: "store", color: GMAP_COLORS.shopping, x: 40, z: 35, icon: "🏬" }
  ],
  timesSquare: [
    { id: "t1", name: "타임스퀘어 - 42번가역", type: "subway", line: "N Q R W", color: "#F59E0B", x: 0, z: 0, icon: "🚇" },
    { id: "t2", name: "마운트 시나이 응급센터", type: "hospital", color: GMAP_COLORS.hospital, x: -65, z: -35, icon: "🏥" },
    { id: "t3", name: "브로드웨이 극장가", type: "landmark", color: GMAP_COLORS.landmark, x: 30, z: 45, icon: "🎭" }
  ]
};
