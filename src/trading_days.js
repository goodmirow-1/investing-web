/**
 * trading_days.js
 * 한국 주식시장(KRX) 영업일 계산 유틸리티
 *
 * 공휴일 출처: KRX 공식 홈페이지 (https://www.krx.co.kr)
 * - 토/일 휴장 + 법정공휴일 + KRX 연말 휴장일 포함
 * - 매년 말 KRX 공식 발표로 업데이트 필요
 */

/**
 * KRX 휴장일 목록 (YYYY-MM-DD 문자열)
 * 주말(토/일)은 코드에서 자동 처리하므로 별도 포함 불필요
 */
const KRX_HOLIDAYS = new Set([
    // ── 2025년 ──────────────────────────────────────────────
    '2025-01-01', // 신정
    '2025-01-28', // 설날 전날
    '2025-01-29', // 설날
    '2025-01-30', // 설날 다음날
    '2025-03-01', // 삼일절
    '2025-05-01', // 근로자의 날
    '2025-05-05', // 어린이날
    '2025-05-06', // 어린이날 대체공휴일
    '2025-06-06', // 현충일
    '2025-08-15', // 광복절
    '2025-10-03', // 개천절
    '2025-10-05', // 추석 전날
    '2025-10-06', // 추석
    '2025-10-07', // 추석 다음날
    '2025-10-08', // 추석 대체공휴일
    '2025-10-09', // 한글날
    '2025-12-25', // 성탄절
    '2025-12-31', // KRX 연말 휴장

    // ── 2026년 ──────────────────────────────────────────────
    '2026-01-01', // 신정
    '2026-02-16', // 설날 전날
    '2026-02-17', // 설날
    '2026-02-18', // 설날 다음날
    '2026-03-01', // 삼일절
    '2026-03-02', // 삼일절 대체공휴일
    '2026-05-01', // 근로자의 날
    '2026-05-05', // 어린이날
    '2026-05-25', // 부처님오신날 대체공휴일
    '2026-08-17', // 광복절 대체공휴일
    '2026-09-24', // 추석 전날
    '2026-09-25', // 추석
    '2026-09-26', // 추석 다음날
    '2026-10-05', // 개천절 대체공휴일
    '2026-10-09', // 한글날
    '2026-12-25', // 성탄절
    '2026-12-31', // KRX 연말 휴장

    // ── 2027년 (예정, KRX 공식 발표 후 업데이트 필요) ──────
    '2027-01-01', // 신정
    '2027-02-07', // 설날 전날
    '2027-02-08', // 설날
    '2027-02-09', // 설날 다음날
    '2027-03-01', // 삼일절
    '2027-05-01', // 근로자의 날
    '2027-05-05', // 어린이날
    '2027-06-06', // 현충일
    '2027-08-16', // 광복절 대체공휴일
    '2027-09-14', // 추석 전날
    '2027-09-15', // 추석
    '2027-09-16', // 추석 다음날
    '2027-10-04', // 개천절 대체공휴일
    '2027-10-09', // 한글날 (토요일이면 미적용 확인 필요)
    '2027-12-25', // 성탄절
    '2027-12-31', // KRX 연말 휴장 (미확정)
]);

/**
 * 해당 날짜가 KRX 휴장일(공휴일 또는 주말)인지 확인
 * @param {Date} date
 * @returns {boolean}
 */
function isHoliday(date) {
    const day = date.getDay(); // 0=일, 6=토
    if (day === 0 || day === 6) return true;

    const dateStr = toDateString(date);
    return KRX_HOLIDAYS.has(dateStr);
}

/**
 * Date → 'YYYY-MM-DD' 문자열 변환 (한국 로컬 기준)
 * @param {Date} date
 * @returns {string}
 */
function toDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 두 날짜 사이의 KRX 영업일 수를 계산
 * @param {Date|string} fromDate  - 시작일 (지정일, 포함하지 않음)
 * @param {Date|string} toDate    - 종료일 (오늘, 포함)
 * @returns {number} 영업일 수 (D+N의 N)
 */
function countTradingDays(fromDate, toDate) {
    const start = typeof fromDate === 'string' ? new Date(fromDate + 'T00:00:00') : new Date(fromDate);
    const end = typeof toDate === 'string' ? new Date(toDate + 'T00:00:00') : new Date(toDate);

    // 시작일이 종료일보다 이후면 0 반환
    if (start > end) return 0;

    let count = 0;
    const current = new Date(start);

    while (current <= end) {
        if (!isHoliday(current)) {
            count++;
        }
        current.setDate(current.getDate() + 1);
    }

    return count;
}

/**
 * 지정일로부터 N 영업일 이후의 날짜를 반환
 * @param {Date|string} fromDate - 시작일
 * @param {number} n - 영업일 수
 * @returns {Date}
 */
function addTradingDays(fromDate, n) {
    const start = typeof fromDate === 'string' ? new Date(fromDate + 'T00:00:00') : new Date(fromDate);
    const current = new Date(start);
    let count = 0;

    while (count < n) {
        current.setDate(current.getDate() + 1);
        if (!isHoliday(current)) {
            count++;
        }
    }

    return current;
}

/**
 * 오늘이 KRX 영업일인지 확인
 * @returns {boolean}
 */
function isTodayTradingDay() {
    return !isHoliday(new Date());
}

module.exports = {
    countTradingDays,
    addTradingDays,
    isHoliday,
    isTodayTradingDay,
    KRX_HOLIDAYS,
};
