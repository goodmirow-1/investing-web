/**
 * kokstock_scheduler.js
 * 투자경고 종목 자동 수집 및 해제 여부 검증 스케줄러
 */
const cron = require('node-cron');
const axios = require('axios');
const scraper = require('./kokstock_scraper');
const tracker = require('./warning_tracker');
const { countTradingDays } = require('./trading_days');

const parsePrice = (val) => parseInt(String(val).replace(/,/g, ''), 10);

/** Naver에서 오늘의 종가 조회 */
async function fetchCurrentPrices(stocks) {
    const priceMap = {};
    for (const stock of stocks) {
        try {
            const url = `https://m.stock.naver.com/api/stock/${stock.code}/basic`;
            const res = await axios.get(url, { timeout: 8000 });
            if (res.data && res.data.closePrice) {
                priceMap[stock.code] = {
                    price: parsePrice(res.data.closePrice),
                    designatedDate: stock.designatedDate,
                };
            }
        } catch (e) {
            console.error(`[Scheduler] Failed to fetch price for ${stock.code}: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 300));
    }
    return priceMap;
}

/** 20:30 데이터 수집 작업 */
async function runDailyCollection() {
    console.log('[Scheduler] Starting daily warning collection (20:30)...');
    try {
        const scraped = await scraper.scrapeKokstockWarnings();
        if (scraped.length === 0) return;
        const priceMap = await fetchCurrentPrices(scraped);
        const addedCount = tracker.addTodayWarnings(scraped, priceMap);
        console.log(`[Scheduler] Added ${addedCount} new stocks to warning history.`);
    } catch (err) {
        console.error('[Scheduler] Collection failed:', err.message);
    }
}

/** 00:01 해제 여부 검증 작업 */
async function runReleaseCheck() {
    console.log('[Scheduler] Starting daily release status check (00:01)...');
    try {
        const warnings = tracker.getAllWarnings();
        const today = new Date();

        // D+10(영업일) 이상 경과한 해제 확인 대상 추출
        const checkTargets = warnings.filter(w => {
            const tradingDaysElapsed = countTradingDays(w.designatedDate, today);
            const isTarget = tradingDaysElapsed >= 10 && !w.isReleased;
            if (!isTarget && !w.isReleased) {
                console.log(`[Scheduler] Skipping ${w.name}: D+${tradingDaysElapsed} (Needs D+10)`);
            }
            return isTarget;
        });

        if (checkTargets.length === 0) {
            console.log('[Scheduler] No stocks to check for release status today (D+10 not reached or already released).');
            return [];
        }

        console.log(`[Scheduler] Checking ${checkTargets.length} stocks for release status via Naver API...`);
        const verifiedResults = [];

        for (const target of checkTargets) {
            try {
                const url = `https://m.stock.naver.com/api/stock/${target.code}/basic`;
                const res = await axios.get(url, { timeout: 8000 });
                const currentStatus = res.data?.marketAlertType?.text || '';

                // "투자경고"가 아니면 해제된 것으로 간주
                const isStillWarning = currentStatus.includes('투자경고') || currentStatus.includes('투자위험');

                verifiedResults.push({
                    code: target.code,
                    name: target.name,
                    designatedDate: target.designatedDate,
                    isStillWarning: isStillWarning
                });
                console.log(`[Scheduler] Verified ${target.name}: ${isStillWarning ? 'STILL WARNING' : 'RELEASED'}`);
            } catch (e) {
                console.error(`[Scheduler] Failed to verify ${target.code}: ${e.message}`);
            }
            // API 부하 방지
            await new Promise(r => setTimeout(r, 500));
        }

        const results = tracker.verifyAndStoreReleaseStatus(verifiedResults);
        console.log(`[Scheduler] Processed ${results.length} verified results.`);
        return results;
    } catch (err) {
        console.error('[Scheduler] Release check failed:', err.message);
        return [];
    }
}

/** 스케줄러 시작 */
function startScheduler() {
    // 1. 매일 20:30 데이터 수집 (평일)
    cron.schedule('30 20 * * 1-5', runDailyCollection, { timezone: 'Asia/Seoul' });

    // 2. 매일 00:01 해제 여부 확인 (매일)
    cron.schedule('01 00 * * *', runReleaseCheck, { timezone: 'Asia/Seoul' });

    console.log('[Scheduler] All tasks scheduled (20:30 Collection, 00:01 Release Check)');

    console.log('[Scheduler] Running tasks once on startup as requested...');
    runDailyCollection().then(() => runReleaseCheck()).catch(err => console.error('[Scheduler] Startup error:', err));
}

module.exports = {
    startScheduler,
    runOnce: runDailyCollection,
    runReleaseCheck
};
