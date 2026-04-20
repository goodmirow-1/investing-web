const { countTradingDays } = require('./src/trading_days');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'warning_history.json');
const today = new Date('2026-04-21T00:30:00'); // 현재 시각 시뮬레이션

console.log('=== 영업일 계산 로직 검증 시작 ===');
console.log('기준 날짜:', today.toISOString());

const warnings = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

// 최근 종목들 중 확인 대상이 될만한 것들 샘플링
const samples = warnings.filter(w => w.designatedDate >= '2026-04-01').slice(0, 10);

samples.forEach(w => {
    const days = countTradingDays(w.designatedDate, today);
    console.log(`[${w.name}] 지정일: ${w.designatedDate}, D+${days} ${days >= 10 ? '★ 대상!' : '(미달)'}`);
});

console.log('=== 검증 종료 ===');
