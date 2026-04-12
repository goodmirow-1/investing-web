document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('tickerForm');
    const input = document.getElementById('tickerInput');
    const resultsSection = document.getElementById('resultsSection');
    const loadingBar = document.getElementById('loadingIndicator');
    const searchBtn = document.getElementById('searchBtn');
    const searchBtnText = document.getElementById('searchBtnText');
    const searchBtnSpinner = document.getElementById('searchBtnSpinner');
    const cards = document.querySelectorAll('.card');

    // 인터스티셜 광고
    const adOverlay = document.getElementById('adOverlay');
    const countdownText = document.getElementById('countdownText');
    const timerProgress = document.getElementById('timerProgress');
    const seeResultsBtn = document.getElementById('seeResultsBtn');

    let searchCount = parseInt(sessionStorage.getItem('searchCount') || '0', 10);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ticker = input.value.trim();

        if (!ticker || ticker.length !== 6 || !/^\d{6}$/.test(ticker)) {
            showToast('올바른 6자리 종목코드를 입력하세요. (예: 005930)', 'error');
            return;
        }

        if (searchCount > 1000) {
            showAdGate(() => performSearch(ticker));
        } else {
            await performSearch(ticker);
            searchCount++;
            sessionStorage.setItem('searchCount', searchCount);
        }
    });

    // ─── 검색 실행 ──────────────────────────────────────────
    async function performSearch(ticker) {
        // UI 초기화
        resultsSection.classList.add('hidden');
        loadingBar.classList.remove('hidden');
        cards.forEach(c => c.classList.remove('show'));
        setSearchLoading(true);

        try {
            const response = await fetch(`/api/stock/${ticker}`);
            const data = await response.json();
            console.log(data);

            loadingBar.classList.add('hidden');
            setSearchLoading(false);

            if (!response.ok) {
                showToast(data.error || '조회 실패. 종목코드를 확인하세요.', 'error');
                return;
            }

            renderResults(data);

        } catch (err) {
            loadingBar.classList.add('hidden');
            setSearchLoading(false);
            showToast('서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.', 'error');
            console.error('[Fetch Error]', err);
        }
    }

    // ─── 결과 렌더링 ─────────────────────────────────────────
    function renderResults(data) {
        // 종목 기본 정보
        document.getElementById('displayTicker').textContent = data.ticker;
        document.getElementById('displayStockName').textContent = data.stockName;
        const currentPrice = data.currentPrice;
        document.getElementById('currentPriceDisplay').textContent = currentPrice.toLocaleString();

        // 경고 상태 배지
        const alertBadge = document.getElementById('displayMarketAlert');
        if (data.marketAlert) {
            alertBadge.textContent = data.marketAlert;
            alertBadge.classList.remove('hidden');
            // 상태별 색상 적용 (투자경고, 투자위험은 더 강조)
            alertBadge.className = 'market-alert-badge';
            if (data.marketAlert.includes('경고') || data.marketAlert.includes('위험')) {
                alertBadge.classList.add('danger');
            } else {
                alertBadge.classList.add('caution');
            }
        } else {
            alertBadge.classList.add('hidden');
        }

        // 캐시 배지
        const cachedBadge = document.getElementById('displayCachedBadge');
        if (data.cachedAt) {
            cachedBadge.classList.remove('hidden');
            cachedBadge.title = `캐시 시각: ${new Date(data.cachedAt).toLocaleTimeString()}`;
        } else {
            cachedBadge.classList.add('hidden');
        }

        // ── 경고 목표가 + 조건 충족 여부 ────────────────────
        const updateWarning = (targetId, statusId, targetValue) => {
            document.getElementById(targetId).textContent = Math.floor(targetValue).toLocaleString();
            const statusEl = document.getElementById(statusId);
            if (statusEl) {
                if (currentPrice >= targetValue) {
                    statusEl.textContent = '⚠️ 조건 충족 (위험)';
                    statusEl.style.color = 'var(--warning-color)';
                } else {
                    const gap = Math.floor(targetValue - currentPrice);
                    statusEl.textContent = `✓ 미달 (-${gap.toLocaleString()}원 필요)`;
                    statusEl.style.color = 'var(--text-secondary)';
                }
            }
        };

        updateWarning('targetUltraShort', 'statusUltraShort', data.warningTargets.ultraShort);
        updateWarning('targetShort', 'statusShort', data.warningTargets.short);
        updateWarning('targetMidLong', 'statusMidLong', data.warningTargets.midLong);
        updateWarning('targetCautionRep', 'statusCautionRep', data.warningTargets.cautionRep);
        updateWarning('targetCaution', null, data.warningTargets.cautionPrice3d);
        updateWarning('targetCaution15d', 'statusCaution15d', data.warningTargets.cautionPrice15d);

        // ── 단기과열 ────────────────────────────────────────
        document.getElementById('targetOverheating').textContent = Math.floor(data.warningTargets.overheating40d).toLocaleString();

        const setOverheatRow = (valId, statusId, value, isMet) => {
            const valEl = document.getElementById(valId);
            const statusEl = document.getElementById(statusId);
            if (valEl) valEl.textContent = parseFloat(value).toFixed(1);
            if (statusEl) {
                statusEl.textContent = isMet ? '충족' : '미달';
                statusEl.className = 'condition-tag ' + (isMet ? 'met' : 'notmet');
            }
        };

        const ovheat = data.overheat;
        // 주가 상승률 상태
        const statusOvheatPrice = document.getElementById('statusOverheatPrice');
        if (statusOvheatPrice) {
            statusOvheatPrice.textContent = `${ovheat.priceIncreaseRate}% ${ovheat.criteriaMet.price ? '⚠️ 충족' : '✓ 미달'}`;
            statusOvheatPrice.style.color = ovheat.criteriaMet.price ? 'var(--warning-color)' : 'var(--text-secondary)';
        }
        setOverheatRow('valOverheatTurnover', 'statusOverheatTurnover', ovheat.turnoverRatio, ovheat.criteriaMet.turnover);
        setOverheatRow('valOverheatVolatility', 'statusOverheatVolatility', ovheat.volatilityRatio, ovheat.criteriaMet.volatility);

        // 단기과열 종합
        const allMet = ovheat.criteriaMet.price && ovheat.criteriaMet.turnover && ovheat.criteriaMet.volatility;
        const overheatSummary = document.getElementById('overheatSummary');
        if (overheatSummary) {
            overheatSummary.textContent = allMet ? '⚠️ 3가지 조건 모두 충족 — 단기과열 예고 위험' : `${Object.values(ovheat.criteriaMet).filter(Boolean).length}/3 조건 충족`;
            overheatSummary.className = 'condition-tag ' + (allMet ? 'met' : 'notmet');
        }

        // ── 시장감시 ─────────────────────────────────────────
        // 종가 급변
        const statusClose = document.getElementById('statusClosingSudden');
        if (statusClose) {
            const isSudden = data.stats.isClosingSudden || currentPrice >= data.warningTargets.cautionPrice3d;
            statusClose.textContent = isSudden
                ? `⚠️ 위험 (변동률 ${data.priceChangePct}%)`
                : `✓ 정상 (변동률 ${data.priceChangePct}%)`;
            statusClose.style.color = isSudden ? 'var(--warning-color)' : 'var(--text-secondary)';
        }

        // 15일 최고가 여부
        const val15 = document.getElementById('val15DayHigh');
        if (val15) {
            val15.textContent = data.stats.is15DayHigh
                ? '✅ 최고가 달성'
                : `미달성 (최고가: ${data.stats.max15Price.toLocaleString()}원)`;
            val15.style.color = data.stats.is15DayHigh ? 'var(--warning-color)' : 'var(--text-secondary)';
        }

        // 15일 상승일수
        const rising = data.stats.risingDays15;
        document.getElementById('countRising15').textContent = rising;
        const risingStatus = document.getElementById('statusRising15');
        if (risingStatus) {
            risingStatus.textContent = rising >= 12 ? '충족' : '미달';
            risingStatus.className = 'condition-tag ' + (rising >= 12 ? 'met' : 'notmet');
        }

        // ── UI 표시 ──────────────────────────────────────────
        resultsSection.classList.remove('hidden');
        cards.forEach((card, i) => {
            setTimeout(() => card.classList.add('show'), i * 120 + 50);
        });
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ─── 인터스티셜 광고 ─────────────────────────────────────
    function showAdGate(onComplete) {
        adOverlay.classList.remove('hidden');
        seeResultsBtn.classList.add('hidden');
        seeResultsBtn.disabled = true;

        let timeLeft = 30;
        countdownText.textContent = timeLeft;
        timerProgress.style.strokeDashoffset = '283';

        const timer = setInterval(() => {
            timeLeft--;
            countdownText.textContent = timeLeft;
            const offset = 283 * (timeLeft / 30);
            timerProgress.style.strokeDashoffset = offset;

            if (timeLeft <= 0) {
                clearInterval(timer);
                seeResultsBtn.classList.remove('hidden');
                seeResultsBtn.disabled = false;
            }
        }, 1000);

        seeResultsBtn.onclick = () => {
            adOverlay.classList.add('hidden');
            clearInterval(timer);
            searchCount++;
            sessionStorage.setItem('searchCount', searchCount);
            onComplete();
        };
    }

    // ─── 유틸 ───────────────────────────────────────────────
    function setSearchLoading(isLoading) {
        searchBtn.disabled = isLoading;
        searchBtnText.classList.toggle('hidden', isLoading);
        searchBtnSpinner.classList.toggle('hidden', !isLoading);
    }

    function showToast(msg, type = 'info') {
        const toast = document.createElement('div');
        toast.textContent = msg;
        Object.assign(toast.style, {
            position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
            background: type === 'error' ? 'var(--warning-color)' : 'var(--info-color)',
            color: '#fff', padding: '12px 24px', borderRadius: '8px',
            fontWeight: '600', zIndex: '99999', fontSize: '.9rem',
            boxShadow: '0 4px 20px rgba(0,0,0,.4)', transition: 'opacity .3s'
        });
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
    }
});
