/**
 * warning_tracker.js
 * 투자경고 종목 지정/해제 조건 추적 모듈
 */
const fs = require('fs');
const path = require('path');
const { countTradingDays } = require('./trading_days');

const DATA_FILE = path.join(__dirname, '..', 'data', 'warning_history.json');
const STATUS_FILE = path.join(__dirname, '..', 'data', 'release_check_history.json');

// 데이터 디렉토리 생성
function ensureDataDir() {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/** 투자경보 해제 확인 이력 로드 */
function loadStatusHistory() {
    ensureDataDir();
    if (!fs.existsSync(STATUS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    } catch {
        return [];
    }
}

/** 투자경보 해제 확인 이력 저장 */
function saveStatusHistory(data) {
    ensureDataDir();
    fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/** 전체 경고 종목 이력 로드 */
function loadWarnings() {
    ensureDataDir();
    if (!fs.existsSync(DATA_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return [];
    }
}

/** 전체 경고 종목 이력 저장 */
function saveWarnings(data) {
    ensureDataDir();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/** 해제 기준가 계산 (alert.md 기반) */
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

/** 신규 지정 종목 추가 */
function addTodayWarnings(scrapedStocks, priceMap) {
    const warnings = loadWarnings();
    let addedCount = 0;

    for (const stock of scrapedStocks) {
        const designatedDate = stock.designatedDate;
        const alreadyExists = warnings.some(
            w => w.code === stock.code && w.designatedDate === designatedDate
        );
        if (alreadyExists) continue;

        const priceInfo = priceMap[stock.code];
        if (!priceInfo) continue;

        const releaseType = stock.releaseType || 'normal';
        const releaseInfo = computeReleaseInfo(priceInfo.price, releaseType);

        warnings.push({
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

    saveWarnings(warnings);
    return addedCount;
}

/**
 * Naver API 등을 통해 확인된 상태 결과들을 받아 이력을 저장합니다. (00:01 실행용)
 * @param {Array} verifiedResults - [{code, name, designatedDate, isStillWarning}]
 */
function verifyAndStoreReleaseStatus(verifiedResults) {
    const warnings = loadWarnings();
    const history = loadStatusHistory();
    const today = new Date().toISOString().split('T')[0];

    const checkResults = [];

    for (const res of verifiedResults) {
        const target = warnings.find(w => w.code === res.code && w.designatedDate === res.designatedDate);
        if (!target) continue;

        const status = res.isStillWarning ? 'extended' : 'released';

        const result = {
            checkDate: today,
            code: target.code,
            name: target.name,
            designatedDate: target.designatedDate,
            status: status,
            msg: res.isStillWarning ? '투자경고 연장됨' : '투자경고 해제됨'
        };

        // 중복 체크 (하루에 한 종목당 하나만)
        const alreadyChecked = history.some(h => h.checkDate === today && h.code === target.code);
        if (!alreadyChecked) {
            history.unshift(result);
            checkResults.push(result);

            if (res.isStillWarning) {
                target.isExtended = true;
                target.extendedCheckDate = today;
            } else {
                target.isReleased = true;
                target.releasedCheckDate = today;
            }
        }
    }

    if (checkResults.length > 0) {
        saveStatusHistory(history.slice(0, 500));
        saveWarnings(warnings);
    }

    return checkResults;
}

function getAllWarnings() {
    return loadWarnings().sort((a, b) => b.designatedDate.localeCompare(a.designatedDate));
}

function getWarningByCode(code) {
    return loadWarnings().filter(w => w.code === code)
        .sort((a, b) => b.designatedDate.localeCompare(a.designatedDate));
}

function getStatusHistory() {
    return loadStatusHistory();
}

module.exports = {
    loadWarnings,
    saveWarnings,
    addTodayWarnings,
    getAllWarnings,
    getWarningByCode,
    computeReleaseInfo,
    verifyAndStoreReleaseStatus,
    getStatusHistory
};
