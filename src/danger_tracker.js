/**
 * danger_tracker.js
 * 투자위험 종목 지정/해제 조건 추적 모듈
 * (warning_tracker.js 와 동일한 구조, 별도 데이터 파일 사용)
 */
const fs = require('fs');
const path = require('path');
const { countTradingDays } = require('./trading_days');

const DATA_FILE = path.join(__dirname, '..', 'data', 'danger_history.json');
const STATUS_FILE = path.join(__dirname, '..', 'data', 'danger_release_check_history.json');

// 데이터 디렉토리 생성
function ensureDataDir() {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/** 투자위험 해제 확인 이력 로드 */
function loadStatusHistory() {
    ensureDataDir();
    if (!fs.existsSync(STATUS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    } catch {
        return [];
    }
}

/** 투자위험 해제 확인 이력 저장 */
function saveStatusHistory(data) {
    ensureDataDir();
    fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/** 전체 위험 종목 이력 로드 */
function loadDangers() {
    ensureDataDir();
    if (!fs.existsSync(DATA_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return [];
    }
}

/** 전체 위험 종목 이력 저장 */
function saveDangers(data) {
    ensureDataDir();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/** 해제 기준가 계산 (투자위험 – alert.md 기반, 투자경고와 동일 로직 재활용) */
function computeReleaseInfo(designatedPrice, releaseType) {
    if (releaseType === 'unsound') {
        return {
            releaseMinPrice: Math.ceil(designatedPrice * 1.75),
            releaseDetail: '지정가 × 175% (불건전형: T-5 45%↑, T-15 75%↑ 동시 불충족 시 해제)',
        };
    } else {
        return {
            releaseMinPrice: Math.ceil(designatedPrice * 2.0),
            releaseDetail: '지정가 × 200% (일반형: T-5 60%↑, T-15 100%↑ 동시 불충족 시 해제)',
        };
    }
}

/** 신규 지정 종목 추가 (또는 기존 종목 정보 업데이트) */
function addTodayDangers(scrapedStocks, priceMap) {
    const dangers = loadDangers();
    let addedCount = 0;
    let updatedCount = 0;

    for (const stock of scrapedStocks) {
        let target = dangers.find(
            d => d.code === stock.code && !d.isReleased
        );

        const priceInfo = priceMap[stock.code];

        if (target) {
            // 해당사이트 데이터로 업데이트
            target.designatedDate = stock.designatedDate;
            if (priceInfo) {
                target.designatedPrice = priceInfo.price;
                const releaseInfo = computeReleaseInfo(target.designatedPrice, target.releaseType || 'normal');
                target.releaseMinPrice = releaseInfo.releaseMinPrice;
                target.releaseDetail = releaseInfo.releaseDetail;
            }
            updatedCount++;
            continue;
        }

        // 신규 종목인 경우 추가
        if (!priceInfo) continue;

        const designatedDate = stock.designatedDate;
        const releaseType = stock.releaseType || 'normal';
        const releaseInfo = computeReleaseInfo(priceInfo.price, releaseType);

        dangers.push({
            code: stock.code,
            name: stock.name,
            market: stock.market || 'KOSDAQ',
            designatedDate,
            designatedPrice: priceInfo.price,
            releaseType,
            releaseMinPrice: releaseInfo.releaseMinPrice,
            releaseDetail: releaseInfo.releaseDetail,
            addedAt: new Date().toISOString(),
        });
        addedCount++;
    }

    saveDangers(dangers);
    return { addedCount, updatedCount };
}

/**
 * Naver API 등을 통해 확인된 상태 결과들을 받아 이력을 저장합니다. (00:01 실행용)
 * @param {Array} verifiedResults - [{code, name, designatedDate, isStillDanger}]
 */
function verifyAndStoreDangerReleaseStatus(verifiedResults) {
    const dangers = loadDangers();
    const history = loadStatusHistory();
    const today = new Date().toISOString().split('T')[0];

    const checkResults = [];

    for (const res of verifiedResults) {
        const target = dangers.find(d => d.code === res.code && d.designatedDate === res.designatedDate);
        if (!target) continue;

        const status = res.isStillDanger ? 'extended' : 'released';

        const result = {
            checkDate: today,
            code: target.code,
            name: target.name,
            designatedDate: target.designatedDate,
            status: status,
            msg: res.isStillDanger ? '투자위험 연장됨' : '투자위험 해제됨'
        };

        // 중복 체크 (하루에 한 종목당 하나만)
        const alreadyChecked = history.some(h => h.checkDate === today && h.code === target.code);
        if (!alreadyChecked) {
            history.unshift(result);
            checkResults.push(result);

            if (res.isStillDanger) {
                target.isExtended = true;
                target.extendedCheckDate = today;
                if (!target.firstExtendedDate) {
                    target.firstExtendedDate = today;
                }
            } else {
                target.isReleased = true;
                target.releasedCheckDate = today;
            }
        }
    }

    if (checkResults.length > 0) {
        saveStatusHistory(history.slice(0, 500));
        saveDangers(dangers);
    }

    return checkResults;
}

function getAllDangers() {
    return loadDangers().sort((a, b) => b.designatedDate.localeCompare(a.designatedDate));
}

function getDangerByCode(code) {
    return loadDangers().filter(d => d.code === code)
        .sort((a, b) => b.designatedDate.localeCompare(a.designatedDate));
}

function getDangerStatusHistory() {
    return loadStatusHistory();
}

module.exports = {
    loadDangers,
    saveDangers,
    addTodayDangers,
    getAllDangers,
    getDangerByCode,
    computeReleaseInfo,
    verifyAndStoreDangerReleaseStatus,
    getDangerStatusHistory
};
