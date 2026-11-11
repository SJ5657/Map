import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import locationRoutes from "./routes/locations.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// 미들웨어 설정
app.use(cors({
  origin: process.env.CLIENT_URL || "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 간단한 요청 로거
app.use((req, res, next) => {
  const now = new Date().toISOString().split("T")[1].slice(0, 8);
  console.log(`[${now}] ${req.method} ${req.url}`);
  next();
});

// 헬스체크 엔드포인트
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Map Exploration Game API Server",
    timestamp: new Date().toISOString()
  });
});

// 라우터 연결
app.use("/api/locations", locationRoutes);

// 404 핸들러
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `경로 ${req.originalUrl}를 찾을 수 없습니다.`
  });
});

// 전역 에러 핸들러
app.use((err, req, res, next) => {
  console.error("서버 에러:", err);
  res.status(500).json({
    success: false,
    message: "서버 내부 오류가 발생했습니다.",
    error: err.message
  });
});

app.listen(PORT, () => {
  console.log(`🚀 [Express] 백엔드 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  console.log(`📡 [API] 위치 목록: http://localhost:${PORT}/api/locations`);
  console.log(`📡 [API] 헬스체크: http://localhost:${PORT}/api/health`);
});
