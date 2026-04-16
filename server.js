const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { fetchStockData } = require('./src/api');

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

// ── KRX 시장경보 파일 다운로드 ─────────────────────────────
app.get('/api/krx/download', apiLimiter, async (req, res) => {
    const { fromDate, toDate } = req.query;

    if (!/^\d{8}$/.test(fromDate) || !/^\d{8}$/.test(toDate)) {
        return res.status(400).json({ error: '날짜 형식이 올바르지 않습니다.' });
    }

    try {
        const axios = require('axios');

        const HEADERS = {
            'Referer': 'https://moc.krx.co.kr/contents/SVL/M/03020200/MOC03020200.jsp',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        };

        // 1단계: 메인 페이지 먼저 접속해서 세션 쿠키 획득
        const sessionRes = await axios.get(
            'https://moc.krx.co.kr/contents/SVL/M/03020200/MOC03020200.jsp',
            { timeout: 10000, headers: HEADERS }
        );
        const cookies = sessionRes.headers['set-cookie'];
        const cookieStr = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';

        // 2단계: OTP 토큰 발급 (쿠키 포함)
        const otpParams = new URLSearchParams({
            name: 'fileDown',
            filetype: 'xls',
            url: 'SVL/M/03020200/moc03020200',
            market_gubun: 'ALL',
            fromDate,
            toDate,
            pagePath: '/contents/SVL/M/03020200/MOC03020200.jsp',
            null: '',
        });

        const otpRes = await axios.get(
            `https://moc.krx.co.kr/contents/COM/GenerateOTP.jspx?${otpParams}`,
            {
                timeout: 10000,
                headers: { ...HEADERS, 'Cookie': cookieStr }
            }
        );

        const otp = String(otpRes.data).trim();
        console.log('[KRX OTP]:', otp);

        if (!otp) throw new Error('OTP 토큰 발급 실패');

        // 3단계: OTP로 실제 파일 다운로드
        const fileRes = await axios.post(
            'https://moc.krx.co.kr/download/COM/fileDown.jspx',
            `code=${otp}`,
            {
                timeout: 15000,
                responseType: 'arraybuffer',
                headers: {
                    ...HEADERS,
                    'Cookie': cookieStr,
                    'Content-Type': 'application/x-www-form-urlencoded',
                }
            }
        );

        // 응답이 실제 xls인지 확인 (암호문이면 에러)
        const contentType = fileRes.headers['content-type'] || '';
        console.log('[KRX File Content-Type]:', contentType);

        const filename = `KRX_시장경보_${fromDate}_${toDate}.xls`;
        res.setHeader('Content-Type', 'application/vnd.ms-excel');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.send(Buffer.from(fileRes.data));

    } catch (error) {
        console.error('[KRX Download Error]:', error.message);
        res.status(500).json({ error: 'KRX 파일 다운로드에 실패했습니다.' });
    }
});

// ── SPA Fallback ──────────────────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(indexHtmlPath);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`[KRX] Server running on http://localhost:${PORT}`);
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
