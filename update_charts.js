const fs = require('fs');
const path = require('path');

const postsDir = path.join(__dirname, 'public', 'posts');
const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.html'));

const configs = {
    'xgate-356680.html': { code: '356680', colorHex: '#58a6ff', colorRgb: '88, 166, 255', targetHex: '#f85149' },
    'dkc-010170.html': { code: '010170', colorHex: '#3fb950', colorRgb: '63, 185, 80', targetHex: '#f85149' },
    'dw-047040.html': { code: '047040', colorHex: '#d29922', colorRgb: '210, 153, 34', targetHex: '#f85149' },
    'gaon-000500.html': { code: '000500', colorHex: '#f85149', colorRgb: '248, 81, 73', targetHex: '#8b949e' }
};

for (const file of files) {
    if (!configs[file]) continue;
    const { code, colorHex, colorRgb, targetHex } = configs[file];
    const filepath = path.join(postsDir, file);
    let content = fs.readFileSync(filepath, 'utf8');

    const replaceText = `// ── 주가 및 기준가 동적 차트 ───────────────────────────────────
        const stockCode = '${code}';
        const colorHex = '${colorHex}';
        const colorRgb = '${colorRgb}';
        const targetHex = '${targetHex}';

        async function loadCharts() {
            try {
                const res = await fetch(\`/api/warnings/\${stockCode}/chart\`);
                if (!res.ok) throw new Error('API Error');
                const data = await res.json();
                const pricesData = data.prices || [];
                if (pricesData.length === 0) return;

                // 최근 60일치 데이터로 시각화 (너무 많으면 차트가 복잡해짐)
                const viewCount = 60;
                const startIndex = Math.max(0, pricesData.length - viewCount);
                const displayData = pricesData.slice(startIndex);
                
                // 라벨 포맷: MM/DD
                const labels = displayData.map(d => {
                    const month = parseInt(d.date.substring(4,6), 10);
                    const day = parseInt(d.date.substring(6,8), 10);
                    return \`\${month}/\${day}\`;
                });
                
                const closePrices = displayData.map(d => d.close);
                const allClosePrices = pricesData.map(d => d.close);

                // 공통 툴팁 옵션
                const tooltipOptions = {
                    backgroundColor: '#161b22',
                    borderColor: '#30363d',
                    borderWidth: 1,
                    titleColor: '#e6edf3',
                    bodyColor: '#8b949e',
                    padding: 12,
                    callbacks: {
                        label: ctx => {
                            if (ctx.parsed.y === null) return null;
                            return \`  \${ctx.dataset.label || '종가'}: \${parseInt(ctx.parsed.y).toLocaleString()}원\`;
                        }
                    }
                };

                // --- 1. 주가 추이 차트 ---
                const canvas1 = document.getElementById('priceChart');
                if (canvas1) {
                    const ctx1 = canvas1.getContext('2d');
                    const gradient1 = ctx1.createLinearGradient(0, 0, 0, 280);
                    gradient1.addColorStop(0, \`rgba(\${colorRgb}, 0.3)\`);
                    gradient1.addColorStop(1, \`rgba(\${colorRgb}, 0.0)\`);

                    new Chart(ctx1, {
                        type: 'line',
                        data: {
                            labels,
                            datasets: [{
                                label: '종가 (원)',
                                data: closePrices,
                                borderColor: colorHex,
                                backgroundColor: gradient1,
                                borderWidth: 2.5,
                                pointRadius: 2,
                                pointHoverRadius: 6,
                                tension: 0.3,
                                fill: true,
                                yAxisID: 'y'
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            interaction: { mode: 'index', intersect: false },
                            plugins: { legend: { display: false }, tooltip: tooltipOptions },
                            scales: {
                                x: { grid: { color: 'rgba(48,54,61,0.5)' }, ticks: { maxRotation: 0, font: { size: 11 } } },
                                y: { 
                                    grid: { color: 'rgba(48,54,61,0.5)' },
                                    ticks: { font: { size: 11 }, callback: v => v >= 10000 ? (v / 10000).toFixed(1) + '만' : parseInt(v).toLocaleString() }
                                }
                            }
                        }
                    });
                }

                // --- 2. 기준가 비교 차트 ---
                const canvas2 = document.getElementById('targetChart');
                if (canvas2) {
                    // 5거래일 전 대비 60% 급등 기준 (단순화: array[-5].close * 1.6)
                    const targetPricesArray = pricesData.map((d, i) => i < 5 ? null : pricesData[i-5].close * 1.6);
                    const displayTargetPrices = targetPricesArray.slice(startIndex);

                    const ctx2 = canvas2.getContext('2d');
                    const gradActual = ctx2.createLinearGradient(0, 0, 0, 280);
                    gradActual.addColorStop(0, \`rgba(\${colorRgb}, 0.25)\`);
                    gradActual.addColorStop(1, \`rgba(\${colorRgb}, 0)\`);

                    new Chart(ctx2, {
                        type: 'line',
                        data: {
                            labels,
                            datasets: [
                                {
                                    label: '실제 종가',
                                    data: closePrices,
                                    borderColor: colorHex,
                                    backgroundColor: gradActual,
                                    borderWidth: 2.5,
                                    pointRadius: 3,
                                    tension: 0.3,
                                    fill: true
                                },
                                {
                                    label: '5일 급등 기준가 (+60%)',
                                    data: displayTargetPrices,
                                    borderColor: targetHex,
                                    backgroundColor: 'transparent',
                                    borderWidth: 2,
                                    borderDash: [6, 4],
                                    pointRadius: 2,
                                    tension: 0.2,
                                    fill: false
                                }
                            ]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            interaction: { mode: 'index', intersect: false },
                            plugins: {
                                legend: { display: true, labels: { boxWidth: 14, font: { size: 11 }, color: '#8b949e' } },
                                tooltip: tooltipOptions
                            },
                            scales: {
                                x: { grid: { color: 'rgba(48,54,61,0.5)' }, ticks: { font: { size: 11 } } },
                                y: { 
                                    grid: { color: 'rgba(48,54,61,0.5)' },
                                    ticks: { font: { size: 11 }, callback: v => v >= 10000 ? (v / 10000).toFixed(1) + '만' : parseInt(v).toLocaleString() }
                                }
                            }
                        }
                    });
                }

                // 고점, 수익률 등 통계 수치 업데이트
                const maxData = Math.max(...allClosePrices);
                const currentPrice = allClosePrices[allClosePrices.length - 1];
                const statCards = document.querySelectorAll('.stat-grid .stat-card');
                
                statCards.forEach(card => {
                    const label = card.querySelector('.stat-label');
                    const value = card.querySelector('.stat-value');
                    if (label && value) {
                        const lblText = label.innerText;
                        if (lblText.includes('고점')) {
                            value.innerText = maxData.toLocaleString() + '원';
                        }
                        if (lblText.includes('연초 대비') || lblText.includes('상승폭')) {
                            const startPrice = allClosePrices[0];
                            const returnRate = Math.round(((currentPrice - startPrice) / startPrice) * 100);
                            value.innerText = (returnRate >= 0 ? '+' : '') + returnRate + '%';
                        }
                    }
                });

            } catch (err) {
                console.error('Failed to load charts', err);
            }
        }
        loadCharts();
    </script>`;

    const startIndex = content.indexOf('// ── 주가 추이 차트');
    if (startIndex !== -1) {
        const endIndex = content.lastIndexOf('</script>');
        content = content.substring(0, startIndex) + replaceText;
        fs.writeFileSync(filepath, content, 'utf8');
        console.log(`Updated ${file}`);
    } else {
        console.log(`Cannot find starting mark in ${file}`);
    }
}
