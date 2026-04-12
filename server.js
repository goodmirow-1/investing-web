const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { fetchStockData } = require('./src/api');

const app = express();

// ── 보안 미들웨어 ──────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://pagead2.googlesyndication.com", "https://fonts.googleapis.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
            frameSrc: ["'none'"],
            connectSrc: ["'self'"]
        }
    }
}));
app.use(cors());

// ── Rate Limiter: API 호출 제한 ───────────────────────────
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,  // 1분
    max: 20,              // 분당 20회
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }
});

// ── 정적 파일 ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API 라우트 ─────────────────────────────────────────────
app.get('/api/stock/:ticker', apiLimiter, async (req, res) => {
    const { ticker } = req.params;

    if (!/^\d{6}$/.test(ticker)) {
        return res.status(400).json({ error: '올바른 6자리 종목코드를 입력하세요.' });
    }

    try {
        const data = await fetchStockData(ticker);
        res.json(data);
    } catch (error) {
        const status = error.status || 500;
        console.error(`[API Error] ${ticker}:`, error.message);
        res.status(status).json({ error: error.message || 'Internal server error' });
    }
});

// ── Health Check ──────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ── SPA Fallback ──────────────────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`[KRX] Server running on http://localhost:${PORT}`);
});
