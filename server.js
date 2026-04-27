const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { fetchStockData } = require('./src/api');
const { getAllWarnings, getWarningByCode, computeReleaseInfo, getStatusHistory } = require('./src/warning_tracker');
const { getAllDangers, getDangerByCode, computeReleaseInfo: computeDangerReleaseInfo, getDangerStatusHistory } = require('./src/danger_tracker');
const { startScheduler } = require('./src/kokstock_scheduler');
const { countTradingDays } = require('./src/trading_days');

const app = express();
app.set('trust proxy', 1);
const indexHtmlPath = path.join(__dirname, 'public', 'index.html');
let indexHtmlTemplate = '';

try {
    indexHtmlTemplate = fs.readFileSync(indexHtmlPath, 'utf8');
} catch (e) {
    console.error('Failed to read index.html', e);
}

// ── 보안 미들웨어 ──────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://pagead2.googlesyndication.com", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
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

const tracker = require('./src/warning_tracker');
const statsFilePath = path.join(__dirname, 'data', 'visitor_stats.json');
let stats = { totalViews: 0, uniqueIps: {}, lastUpdate: '', dailyHistory: [], daily: {} };

try {
    if (fs.existsSync(statsFilePath)) {
        stats = JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));
        if (!stats.dailyHistory) stats.dailyHistory = [];
        if (!stats.daily) stats.daily = {};
    }
} catch (e) {
    console.error('Failed to load visitor stats:', e);
}

// 00:01에 전날 데이터 스냅샷 저장
const cron = require('node-cron');
cron.schedule('01 00 * * *', () => {
    try {
        const d = new Date(new Date().getTime() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
        const yesterdayKST = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

        if (stats.daily && stats.daily[yesterdayKST]) {
            const exists = stats.dailyHistory.find(h => h.date === yesterdayKST);
            if (!exists) {
                stats.dailyHistory.push({
                    date: yesterdayKST,
                    views: stats.daily[yesterdayKST].views,
                    uniqueIps: Object.keys(stats.daily[yesterdayKST].uniqueIps).length
                });
                delete stats.daily[yesterdayKST];
                fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2));
                console.log(`[VisitorTracker] Daily snapshot for ${yesterdayKST} saved.`);
            }
        }
    } catch (e) {
        console.error('[VisitorTracker] Snapshot failed:', e);
    }
}, { timezone: 'Asia/Seoul' });

const trackVisitor = (req, res, next) => {
    // 정적 파일이나 API 요청은 제외하고 페이지 접속만 카운트하고 싶을 수 있지만,
    // 여기서는 모든 요청을 카운트하되 중복 IP는 uniqueIps에서 체크합니다.
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // 페이지 접속으로 간주되는 요청만 카운트 (HTML 요청 등)
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.includes('.')) {
        stats.totalViews++;

        const d = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
        const todayKST = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

        if (!stats.uniqueIps[ip]) {
            stats.uniqueIps[ip] = {
                count: 0,
                firstVisit: new Date().toISOString(),
                lastVisit: ''
            };
        }
        stats.uniqueIps[ip].count++;
        stats.uniqueIps[ip].lastVisit = new Date().toISOString();
        stats.lastUpdate = new Date().toISOString();

        if (!stats.daily[todayKST]) {
            stats.daily[todayKST] = { views: 0, uniqueIps: {} };
        }
        stats.daily[todayKST].views++;
        stats.daily[todayKST].uniqueIps[ip] = true;

        // 주기적으로 저장 (실시간 저장도 가능하지만 성능 고려)
        try {
            fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2));
        } catch (e) {
            console.error('Failed to save visitor stats:', e);
        }
    }
    next();
};

app.use(trackVisitor);

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

// ── 동적 SEO 주입 라우트 (SSR) ──────────────────────────
app.get('/stock/:ticker', async (req, res) => {
    const { ticker } = req.params;

    // 잘못된 종목코드 형식이면 기본 페이지를 줌
    if (!/^\d{6}$/.test(ticker)) {
        return res.sendFile(indexHtmlPath);
    }

    try {
        const data = await fetchStockData(ticker);

        let modifiedHtml = indexHtmlTemplate;

        const dynamicTitle = `[${data.stockName}] 투자경고 / 단기과열 단일가 조건 및 목표가 얼마? - KRX 시장경보 분석기`;
        const dynamicDesc = `${data.stockName}(${ticker}) 주식의 투자주의, 투자경고, 단기과열(단일가) 지정 요건 충족 여부와 지정 목표가(얼마)를 실시간 공시와 데이터 기반으로 분석합니다.`;

        // 메타 태그 동적 치환
        modifiedHtml = modifiedHtml.replace(
            /<title>.*?<\/title>/,
            `<title>${dynamicTitle}</title>`
        );
        modifiedHtml = modifiedHtml.replace(
            /<meta name="description" content=".*?">/,
            `<meta name="description" content="${dynamicDesc}">`
        );
        modifiedHtml = modifiedHtml.replace(
            /<meta property="og:title" content=".*?">/,
            `<meta property="og:title" content="${dynamicTitle}">`
        );
        modifiedHtml = modifiedHtml.replace(
            /<meta property="og:description" content=".*?">/,
            `<meta property="og:description" content="${dynamicDesc}">`
        );

        res.send(modifiedHtml);
    } catch (error) {
        console.error(`[SEO SSR Error] ${ticker}:`, error.message);
        // 에러나 상장폐지된 종목 등의 경우 원본 메인 페이지를 제공
        res.sendFile(indexHtmlPath);
    }
});


// ── 투자경고 이력 API ──────────────────────────────────────
// 전체 목록
app.get('/api/warnings/list', apiLimiter, (req, res) => {
    try {
        const warnings = getAllWarnings();
        const invitations = warnings.map(w => {
            const tradingDaysElapsed = countTradingDays(w.designatedDate, new Date());
            let extensionDays = 0;
            if (w.isExtended) {
                // 11일째가 1일 연장이므로 (영업일수 - 10)
                extensionDays = Math.max(0, tradingDaysElapsed - 10);
            }
            return {
                ...w,
                tradingDaysElapsed,
                extensionDays
            };
        });
        res.json({ count: invitations.length, items: invitations });
    } catch (error) {
        console.error('[Warning List Error]:', error.message);
        res.status(500).json({ error: '경고 목록 조회 실패' });
    }
});

// 특정 종목 – 저장된 이력 + 실시간 Naver 데이터 기반 해제 가능 여부
app.get('/api/warnings/:code', apiLimiter, async (req, res) => {
    const { code } = req.params;
    if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: '올바른 6자리 종목코드를 입력하세요.' });
    }
    try {
        const history = getWarningByCode(code);
        if (history.length === 0) {
            return res.status(404).json({ error: '해당 종목의 경고 이력이 없습니다.' });
        }

        // 실시간 현재가 조회
        let currentPrice = null;
        try {
            const data = await fetchStockData(code);
            currentPrice = data.currentPrice;
        } catch { /* ignore */ }

        const latest = history[0];
        const releaseInfo = computeReleaseInfo(latest.designatedPrice, latest.releaseType);

        let canRelease = null;
        if (currentPrice !== null) {
            const multiplier5 = latest.releaseType === 'unsound' ? 1.45 : 1.60;
            const multiplier15 = latest.releaseType === 'unsound' ? 1.75 : 2.00;
            const threshold5 = latest.designatedPrice * multiplier5;
            const threshold15 = latest.designatedPrice * multiplier15;
            const meetsAll = currentPrice >= threshold5 && currentPrice >= threshold15;
            canRelease = !meetsAll;
        }

        // 영업일 기준 D+N 계산
        const tradingDaysElapsed = countTradingDays(latest.designatedDate, new Date());

        res.json({
            code,
            items: history,
            currentPrice,
            releaseInfo,
            canRelease,
            tradingDaysElapsed,
            analysis: {
                isExtended: latest.isExtended || false,
                extendedCheckDate: latest.extendedCheckDate || null,
                firstExtendedDate: latest.firstExtendedDate || null,
                extensionDays: latest.isExtended ? Math.max(0, tradingDaysElapsed - 10) : 0
            }
        });
    } catch (error) {
        console.error(`[Warning Detail Error] ${code}:`, error.message);
        res.status(500).json({ error: '데이터 조회 실패' });
    }
});

// 해제 확인 이력 전체 조회 (투자경고)
app.get('/api/warnings/status-check-history', apiLimiter, (req, res) => {
    try {
        const history = getStatusHistory();
        res.json({ count: history.length, items: history });
    } catch (error) {
        console.error('[Status History Error]:', error.message);
        res.status(500).json({ error: '데이터 조회 실패' });
    }
});

// 특정 종목 주가 이력 (지정일 ~ 오늘) - 차트용
app.get('/api/warnings/:code/chart', apiLimiter, async (req, res) => {
    const { code } = req.params;
    if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: '올바른 6자리 종목코드를 입력하세요.' });
    }
    try {
        const axios = require('axios');
        // Naver 일봉 차트 데이터 조회 (최근 100일치)
        const chartUrl = `https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=100&requestType=0`;
        const chartRes = await axios.get(chartUrl, {
            timeout: 8000,
            headers: { 'Referer': 'https://finance.naver.com/' }
        });

        // XML 파싱: <item data="날짜|시가|고가|저가|종가|거래량" />
        const rows = [];
        const itemRegex = /data="([^"]+)"/g;
        let m;
        while ((m = itemRegex.exec(chartRes.data)) !== null) {
            const parts = m[1].split('|');
            if (parts.length >= 5) {
                rows.push({
                    date: parts[0], // YYYYMMDD
                    open: parseInt(parts[1]),
                    high: parseInt(parts[2]),
                    low: parseInt(parts[3]),
                    close: parseInt(parts[4]),
                    volume: parseInt(parts[5] || 0),
                });
            }
        }

        res.json({ code, prices: rows });
    } catch (error) {
        console.error(`[Chart Error] ${code}:`, error.message);
        res.status(500).json({ error: '주가 이력 조회 실패' });
    }
});

// ── 투자위험 이력 API ──────────────────────────────────────
// 전체 목록
app.get('/api/dangers/list', apiLimiter, (req, res) => {
    try {
        const dangers = getAllDangers();
        const items = dangers.map(d => {
            const tradingDaysElapsed = countTradingDays(d.designatedDate, new Date());
            let extensionDays = 0;
            if (d.isExtended) {
                extensionDays = Math.max(0, tradingDaysElapsed - 10);
            }
            return { ...d, tradingDaysElapsed, extensionDays };
        });
        res.json({ count: items.length, items });
    } catch (error) {
        console.error('[Danger List Error]:', error.message);
        res.status(500).json({ error: '위험 목록 조회 실패' });
    }
});

// 해제 확인 이력 전체 조회 (투자위험)
app.get('/api/dangers/status-check-history', apiLimiter, (req, res) => {
    try {
        const history = getDangerStatusHistory();
        res.json({ count: history.length, items: history });
    } catch (error) {
        console.error('[Danger Status History Error]:', error.message);
        res.status(500).json({ error: '데이터 조회 실패' });
    }
});

// 특정 종목 – 저장된 이력 + 실시간 Naver 데이터 기반 해제 가능 여부 (투자위험)
app.get('/api/dangers/:code', apiLimiter, async (req, res) => {
    const { code } = req.params;
    if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: '올바른 6자리 종목코드를 입력하세요.' });
    }
    try {
        const history = getDangerByCode(code);
        if (history.length === 0) {
            return res.status(404).json({ error: '해당 종목의 위험 이력이 없습니다.' });
        }

        let currentPrice = null;
        try {
            const data = await fetchStockData(code);
            currentPrice = data.currentPrice;
        } catch { /* ignore */ }

        const latest = history[0];
        const releaseInfo = computeDangerReleaseInfo(latest.designatedPrice, latest.releaseType);

        let canRelease = null;
        if (currentPrice !== null) {
            const multiplier5 = latest.releaseType === 'unsound' ? 1.45 : 1.60;
            const multiplier15 = latest.releaseType === 'unsound' ? 1.75 : 2.00;
            const threshold5 = latest.designatedPrice * multiplier5;
            const threshold15 = latest.designatedPrice * multiplier15;
            const meetsAll = currentPrice >= threshold5 && currentPrice >= threshold15;
            canRelease = !meetsAll;
        }

        const tradingDaysElapsed = countTradingDays(latest.designatedDate, new Date());

        res.json({
            code,
            items: history,
            currentPrice,
            releaseInfo,
            canRelease,
            tradingDaysElapsed,
            analysis: {
                isExtended: latest.isExtended || false,
                extendedCheckDate: latest.extendedCheckDate || null,
                firstExtendedDate: latest.firstExtendedDate || null,
                extensionDays: latest.isExtended ? Math.max(0, tradingDaysElapsed - 10) : 0
            }
        });
    } catch (error) {
        console.error(`[Danger Detail Error] ${code}:`, error.message);
        res.status(500).json({ error: '데이터 조회 실패' });
    }
});

// 특정 종목 주가 이력 (지정일 ~ 오늘) - 차트용 (투자위험)
app.get('/api/dangers/:code/chart', apiLimiter, async (req, res) => {
    const { code } = req.params;
    if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: '올바른 6자리 종목코드를 입력하세요.' });
    }
    try {
        const axios = require('axios');
        const chartUrl = `https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=100&requestType=0`;
        const chartRes = await axios.get(chartUrl, {
            timeout: 8000,
            headers: { 'Referer': 'https://finance.naver.com/' }
        });

        const rows = [];
        const itemRegex = /data="([^"]+)"/g;
        let m;
        while ((m = itemRegex.exec(chartRes.data)) !== null) {
            const parts = m[1].split('|');
            if (parts.length >= 5) {
                rows.push({
                    date: parts[0],
                    open: parseInt(parts[1]),
                    high: parseInt(parts[2]),
                    low: parseInt(parts[3]),
                    close: parseInt(parts[4]),
                    volume: parseInt(parts[5] || 0),
                });
            }
        }

        res.json({ code, prices: rows });
    } catch (error) {
        console.error(`[Danger Chart Error] ${code}:`, error.message);
        res.status(500).json({ error: '주가 이력 조회 실패' });
    }
});


// ── 관리자 데이터 API ──────────────────────────────────────
app.get('/api/admin/stats', (req, res) => {
    // 실질적인 보안이 필요하다면 여기에 API Key나 세션 체크를 추가할 수 있습니다.
    const uniqueIpCount = Object.keys(stats.uniqueIps).length;
    res.json({
        totalViews: stats.totalViews,
        uniqueIpCount: uniqueIpCount,
        visitorDetails: stats.uniqueIps,
        lastUpdate: stats.lastUpdate,
        dailyHistory: stats.dailyHistory || [],
        daily: stats.daily || {}
    });
});


app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── SPA Fallback ──────────────────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(indexHtmlPath);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`[KRX] Server running on http://localhost:${PORT}`);
    // 투자경고 자동 수집 스케줄러 시작
    startScheduler();
});

// ── Production Load Balancer 등을 위한 3000번 포트 추가 개방 ──
// 개발 환경(dev)에서는 BrowserSync가 3000번 포트를 사용하므로, 프로덕션(pm2)에서만 실행되도록 분기 처리합니다.
if (process.env.NODE_ENV === 'production') {
    app.listen(3000, () => {
        console.log(`[KRX] Production server also listening on port 3000 (For Health Check)`);
    }).on('error', (err) => {
        console.error(`[KRX] Failed to bind port 3000:`, err.message);
    });
}
