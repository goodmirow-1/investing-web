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
    const krxDownloadBtn = document.getElementById('krxDownloadBtn');
    if (krxDownloadBtn) krxDownloadBtn.addEventListener('click', downloadKRXFile);

    let searchCount = parseInt(sessionStorage.getItem('searchCount') || '0', 10);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ticker = input.value.trim();

        if (!ticker || ticker.length !== 6 || !/^\d{6}$/.test(ticker)) {
            showToast('올바른 6자리 종목코드를 입력하세요. (예: 005930)', 'error');
            return;
        }

        const newUrl = `/stock/${ticker}`;
        if (window.location.pathname !== newUrl) {
            window.history.pushState(null, '', newUrl);
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

        // 새로 추가된 불건전요건 목표가 연동
        updateWarning('targetShortUnsound', 'statusShortUnsound', data.warningTargets.shortUnsound);
        updateWarning('targetMidLongUnsound', 'statusMidLongUnsound', data.warningTargets.midLongUnsound);
        updateWarning('targetLongUnsound', 'statusLongUnsound', data.warningTargets.longUnsound);

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

        // 1년 200% 초과 상승 (투자주의)
        const val1YearIncEl = document.getElementById('val1YearIncrease');
        const status1YearIncEl = document.getElementById('status1YearIncrease');
        if (val1YearIncEl && status1YearIncEl) {
            val1YearIncEl.textContent = data.stats.increaseRate1Year;
            status1YearIncEl.textContent = data.stats.is200Pct1Year ? '⚠️ 충족' : '미달';
            status1YearIncEl.className = 'condition-tag ' + (data.stats.is200Pct1Year ? 'met' : 'notmet');
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

    // ─── URL 초기 라우팅 및 뒤로가기 처리 ───────────────
    window.addEventListener('popstate', () => {
        const pParts = window.location.pathname.split('/');
        if (pParts.length === 3 && pParts[1] === 'stock') {
            const t = pParts[2];
            input.value = t;
            performSearch(t);
        } else if (window.location.pathname === '/') {
            input.value = '';
            resultsSection.classList.add('hidden');
        }
    });

    const initPathParts = window.location.pathname.split('/');
    if (initPathParts.length === 3 && initPathParts[1] === 'stock') {
        const initTicker = initPathParts[2];
        if (/^\d{6}$/.test(initTicker)) {
            input.value = initTicker;
            if (searchCount > 1000) {
                showAdGate(() => performSearch(initTicker));
            } else {
                performSearch(initTicker);
                searchCount++;
                sessionStorage.setItem('searchCount', searchCount);
            }
        }
    }
});

// ── KRX 다운로드 버튼 ─────────────────────────────────────
function getToday() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

// ── 탭 전환 로직 ──────────────────────────────────────────
(function initTabs() {
    const tabAnalyzer = document.getElementById('tab-analyzer');
    const tabWarnings = document.getElementById('tab-warnings');
    const tabStatus = document.getElementById('tab-status-check');
    const tabDangers = document.getElementById('tab-dangers');
    const tabDangerCheck = document.getElementById('tab-danger-check');

    const panelAnalyzer = document.getElementById('tab-panel-analyzer');
    const panelWarnings = document.getElementById('tab-panel-warnings');
    const panelStatus = document.getElementById('tab-panel-status-check');
    const panelDangers = document.getElementById('tab-panel-dangers');
    const panelDangerCheck = document.getElementById('tab-panel-danger-check');

    if (!tabAnalyzer || !tabWarnings || !tabStatus) return;

    let warningsLoaded = false;
    let statusLoaded = false;
    let dangersLoaded = false;
    let dangerCheckLoaded = false;
    let activeTab = 'analyzer';

    const allTabs = [tabAnalyzer, tabWarnings, tabStatus, tabDangers, tabDangerCheck].filter(Boolean);
    const allPanels = [panelAnalyzer, panelWarnings, panelStatus, panelDangers, panelDangerCheck].filter(Boolean);

    function switchTab(active) {
        activeTab = active;
        allTabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
        allPanels.forEach(p => { if (p) p.classList.remove('active'); });

        if (active === 'analyzer') {
            tabAnalyzer.classList.add('active');
            tabAnalyzer.setAttribute('aria-selected', 'true');
            if (panelAnalyzer) panelAnalyzer.classList.add('active');
        } else if (active === 'warnings') {
            tabWarnings.classList.add('active');
            tabWarnings.setAttribute('aria-selected', 'true');
            if (panelWarnings) panelWarnings.classList.add('active');
            if (!warningsLoaded) { loadWarningList(); warningsLoaded = true; }
        } else if (active === 'status') {
            tabStatus.classList.add('active');
            tabStatus.setAttribute('aria-selected', 'true');
            if (panelStatus) panelStatus.classList.add('active');
            if (!statusLoaded) { loadReleasedStocksList(); statusLoaded = true; }
        } else if (active === 'dangers') {
            if (tabDangers) { tabDangers.classList.add('active'); tabDangers.setAttribute('aria-selected', 'true'); }
            if (panelDangers) panelDangers.classList.add('active');
            if (!dangersLoaded) { loadDangerList(); dangersLoaded = true; }
        } else if (active === 'dangerCheck') {
            if (tabDangerCheck) { tabDangerCheck.classList.add('active'); tabDangerCheck.setAttribute('aria-selected', 'true'); }
            if (panelDangerCheck) panelDangerCheck.classList.add('active');
            if (!dangerCheckLoaded) { loadReleasedDangerList(); dangerCheckLoaded = true; }
        }
        showWarningList(); // 다른 탭으로 갈 때 상세 페이지가 열려있으면 닫기
    }

    tabAnalyzer.addEventListener('click', () => switchTab('analyzer'));
    tabWarnings.addEventListener('click', () => switchTab('warnings'));
    tabStatus.addEventListener('click', () => switchTab('status'));
    if (tabDangers) tabDangers.addEventListener('click', () => switchTab('dangers'));
    if (tabDangerCheck) tabDangerCheck.addEventListener('click', () => switchTab('dangerCheck'));

    const refreshBtn = document.getElementById('refreshWarningsBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => { loadWarningList(); });

    const refreshStatusBtn = document.getElementById('refreshReleasedBtn');
    if (refreshStatusBtn) refreshStatusBtn.addEventListener('click', () => { loadReleasedStocksList(); });

    const refreshDangersBtn = document.getElementById('refreshDangersBtn');
    if (refreshDangersBtn) refreshDangersBtn.addEventListener('click', () => { loadDangerList(); dangersLoaded = true; });

    const refreshReleasedDangersBtn = document.getElementById('refreshReleasedDangersBtn');
    if (refreshReleasedDangersBtn) refreshReleasedDangersBtn.addEventListener('click', () => { loadReleasedDangerList(); dangerCheckLoaded = true; });

    const backBtn = document.getElementById('detailBackBtn');
    if (backBtn) backBtn.addEventListener('click', () => showWarningList());

    // 전역 헬퍼로 노출 (탭에 따른 목록 제어용)
    window.getCurrentActiveTab = () => activeTab;
})();

// 화면 전환 헬퍼
function showWarningList() {
    const listWrap = document.getElementById('warningsListWrap');
    const relListWrap = document.getElementById('releasedListWrap');
    const dangersListWrap = document.getElementById('dangersListWrap');
    const relDangersListWrap = document.getElementById('releasedDangersListWrap');

    if (listWrap) listWrap.classList.remove('hidden');
    if (relListWrap) relListWrap.classList.remove('hidden');
    if (dangersListWrap) dangersListWrap.classList.remove('hidden');
    if (relDangersListWrap) relDangersListWrap.classList.remove('hidden');

    document.getElementById('warningDetailPanel').classList.add('hidden');
}

function showWarningDetail() {
    const dangersListWrap = document.getElementById('dangersListWrap');
    const relDangersListWrap = document.getElementById('releasedDangersListWrap');

    document.getElementById('warningsListWrap').classList.add('hidden');
    document.getElementById('releasedListWrap').classList.add('hidden');
    if (dangersListWrap) dangersListWrap.classList.add('hidden');
    if (relDangersListWrap) relDangersListWrap.classList.add('hidden');

    document.getElementById('warningDetailPanel').classList.remove('hidden');
    document.getElementById('warningDetailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── 투자경고 목록 로딩 & 렌더링 ──────────────────────────
async function loadWarningList() {
    const loadingBar = document.getElementById('warningsLoadingBar');
    const emptyMsg = document.getElementById('warningsEmptyMsg');
    const listWrap = document.getElementById('warningsListWrap');
    const stockList = document.getElementById('warningsStockList');
    const metaEl = document.getElementById('warningsMeta');

    loadingBar.classList.remove('hidden');
    listWrap.classList.add('hidden');
    emptyMsg.classList.add('hidden');

    try {
        const res = await fetch('/api/warnings/list');
        const data = await res.json();
        loadingBar.classList.add('hidden');

        // 해제되지 않은 종목만 필터링
        const activeItems = data.items.filter(item => !item.isReleased);

        if (!res.ok || activeItems.length === 0) {
            emptyMsg.classList.remove('hidden');
            return;
        }

        const grouped = {};
        activeItems.forEach(w => {
            if (!grouped[w.designatedDate]) grouped[w.designatedDate] = 0;
            grouped[w.designatedDate]++;
        });
        const dates = Object.keys(grouped).sort().reverse();
        metaEl.textContent = `총 ${activeItems.length}건 | 최근 지정일: ${dates[0] || '-'} (${grouped[dates[0]] || 0}개 종목)`;

        stockList.innerHTML = '';
        activeItems.forEach((w, idx) => {
            const market = (w.market || '').toUpperCase();
            const marketClz = market === 'KOSPI' ? 'kospi' : 'kosdaq';
            const tradingDays = w.tradingDaysElapsed ?? 0;

            const li = document.createElement('li');
            li.className = 'warnings-stock-item';
            li.innerHTML = `
                <span class="wsi-rank">${idx + 1}</span>
                <div class="wsi-main">
                    <span class="wsi-name">${escHtml(w.name)}</span>
                    <div class="wsi-sub">
                        <span class="wt-code">${escHtml(w.code)}</span>
                        <span class="wt-market ${marketClz}">${market}</span>
                        <span>지정일 ${escHtml(w.designatedDate)} · D+${tradingDays}</span>
                    </div>
                </div>
                <div class="wsi-prices">
                    ${w.isReleased ? `<span class="wt-badge released" style="margin-bottom:4px;">해제됨</span>` : ''}
                    ${w.isExtended && w.extensionDays > 0 ? `<span class="wt-badge extension" style="margin-bottom:4px; background:var(--warning-color); color:#fff; padding:2px 6px; border-radius:4px; font-size:0.75rem;">${w.extensionDays}일 연장됨</span>` : ''}
                    <span class="wsi-designated">${w.designatedPrice.toLocaleString()}원</span>
                    <span class="wsi-release">해제기준 ${w.releaseMinPrice.toLocaleString()}원</span>
                </div>
                <i class="fa-solid fa-chevron-right wsi-arrow"></i>
            `;
            li.addEventListener('click', () => openWarningDetail(w));
            stockList.appendChild(li);
        });

        listWrap.classList.remove('hidden');
    } catch (err) {
        loadingBar.classList.add('hidden');
        emptyMsg.classList.remove('hidden');
        console.error('[Warning List Error]', err);
    }
}

// ── 해제된 종목 리스트 로딩 (3번째 탭) ──────────────────────────
async function loadReleasedStocksList() {
    const loadingBar = document.getElementById('releasedLoadingBar');
    const emptyMsg = document.getElementById('releasedEmptyMsg');
    const listWrap = document.getElementById('releasedListWrap');
    const stockList = document.getElementById('releasedStockList');
    const metaEl = document.getElementById('releasedMeta');

    loadingBar.classList.remove('hidden');
    listWrap.classList.add('hidden');
    emptyMsg.classList.add('hidden');

    try {
        const res = await fetch('/api/warnings/list');
        const data = await res.json();
        loadingBar.classList.add('hidden');

        if (!res.ok || !data.items) {
            emptyMsg.classList.remove('hidden');
            return;
        }

        // 해제된 종목만 필터링
        const releasedItems = data.items.filter(item => item.isReleased);

        if (releasedItems.length === 0) {
            emptyMsg.classList.remove('hidden');
            return;
        }

        metaEl.textContent = `총 ${releasedItems.length}건 해제됨`;

        stockList.innerHTML = '';
        releasedItems.forEach((w, idx) => {
            const market = (w.market || '').toUpperCase();
            const marketClz = market === 'KOSPI' ? 'kospi' : 'kosdaq';
            const tradingDays = w.tradingDaysElapsed ?? 0;

            const li = document.createElement('li');
            li.className = 'warnings-stock-item';
            li.innerHTML = `
                <span class="wsi-rank">${idx + 1}</span>
                <div class="wsi-main">
                    <span class="wsi-name">${escHtml(w.name)}</span>
                    <div class="wsi-sub">
                        <span class="wt-code">${escHtml(w.code)}</span>
                        <span class="wt-market ${marketClz}">${market}</span>
                        <span>지정일 ${escHtml(w.designatedDate)} · 해제일 ${escHtml(w.releasedCheckDate || '-')}</span>
                    </div>
                </div>
                <div class="wsi-prices">
                    <span class="wt-badge released" style="margin-bottom:4px;">해제완료</span>
                    <span class="wsi-designated">${w.designatedPrice.toLocaleString()}원</span>
                    <span class="wsi-release">해제기준 ${w.releaseMinPrice.toLocaleString()}원</span>
                </div>
                <i class="fa-solid fa-chevron-right wsi-arrow"></i>
            `;
            li.addEventListener('click', () => openWarningDetail(w));
            stockList.appendChild(li);
        });

        listWrap.classList.remove('hidden');
    } catch (err) {
        loadingBar.classList.add('hidden');
        emptyMsg.classList.remove('hidden');
        console.error('[Released List Error]', err);
    }
}

// ── 투자위험 목록 로딩 & 렌더링 (4번째 탭) ──────────────────────────
async function loadDangerList() {
    const loadingBar = document.getElementById('dangersLoadingBar');
    const emptyMsg = document.getElementById('dangersEmptyMsg');
    const listWrap = document.getElementById('dangersListWrap');
    const stockList = document.getElementById('dangersStockList');
    const metaEl = document.getElementById('dangersMeta');

    loadingBar.classList.remove('hidden');
    listWrap.classList.add('hidden');
    emptyMsg.classList.add('hidden');

    try {
        const res = await fetch('/api/dangers/list');
        const data = await res.json();
        loadingBar.classList.add('hidden');

        // 해제되지 않은 종목만 필터링
        const activeItems = data.items ? data.items.filter(item => !item.isReleased) : [];

        if (!res.ok || activeItems.length === 0) {
            emptyMsg.classList.remove('hidden');
            return;
        }

        const grouped = {};
        activeItems.forEach(d => {
            if (!grouped[d.designatedDate]) grouped[d.designatedDate] = 0;
            grouped[d.designatedDate]++;
        });
        const dates = Object.keys(grouped).sort().reverse();
        metaEl.textContent = `총 ${activeItems.length}건 | 최근 지정일: ${dates[0] || '-'} (${grouped[dates[0]] || 0}개 종목)`;

        stockList.innerHTML = '';
        activeItems.forEach((d, idx) => {
            const market = (d.market || '').toUpperCase();
            const marketClz = market === 'KOSPI' ? 'kospi' : 'kosdaq';
            const tradingDays = d.tradingDaysElapsed ?? 0;

            const li = document.createElement('li');
            li.className = 'warnings-stock-item';
            li.innerHTML = `
                <span class="wsi-rank">${idx + 1}</span>
                <div class="wsi-main">
                    <span class="wsi-name">${escHtml(d.name)}</span>
                    <div class="wsi-sub">
                        <span class="wt-code">${escHtml(d.code)}</span>
                        <span class="wt-market ${marketClz}">${market}</span>
                        <span>지정일 ${escHtml(d.designatedDate)} · D+${tradingDays}</span>
                    </div>
                </div>
                <div class="wsi-prices">
                    ${d.isExtended && d.extensionDays > 0 ? `<span class="wt-badge extension" style="margin-bottom:4px; background:var(--warning-color); color:#fff; padding:2px 6px; border-radius:4px; font-size:0.75rem;">${d.extensionDays}일 연장됨</span>` : ''}
                    <span class="wsi-designated">${d.designatedPrice.toLocaleString()}원</span>
                    <span class="wsi-release">해제기준 ${d.releaseMinPrice.toLocaleString()}원</span>
                </div>
                <i class="fa-solid fa-chevron-right wsi-arrow"></i>
            `;
            li.addEventListener('click', () => openDangerDetail(d));
            stockList.appendChild(li);
        });

        listWrap.classList.remove('hidden');
    } catch (err) {
        loadingBar.classList.add('hidden');
        emptyMsg.classList.remove('hidden');
        console.error('[Danger List Error]', err);
    }
}

// ── 투자위험 해제 종목 리스트 로딩 (5번째 탭) ──────────────────────────
async function loadReleasedDangerList() {
    const loadingBar = document.getElementById('releasedDangersLoadingBar');
    const emptyMsg = document.getElementById('releasedDangersEmptyMsg');
    const listWrap = document.getElementById('releasedDangersListWrap');
    const stockList = document.getElementById('releasedDangersStockList');
    const metaEl = document.getElementById('releasedDangersMeta');

    loadingBar.classList.remove('hidden');
    listWrap.classList.add('hidden');
    emptyMsg.classList.add('hidden');

    try {
        const res = await fetch('/api/dangers/list');
        const data = await res.json();
        loadingBar.classList.add('hidden');

        if (!res.ok || !data.items) {
            emptyMsg.classList.remove('hidden');
            return;
        }

        // 해제된 종목만 필터링
        const releasedItems = data.items.filter(item => item.isReleased);

        if (releasedItems.length === 0) {
            emptyMsg.classList.remove('hidden');
            return;
        }

        metaEl.textContent = `총 ${releasedItems.length}건 해제됨`;

        stockList.innerHTML = '';
        releasedItems.forEach((d, idx) => {
            const market = (d.market || '').toUpperCase();
            const marketClz = market === 'KOSPI' ? 'kospi' : 'kosdaq';

            const li = document.createElement('li');
            li.className = 'warnings-stock-item';
            li.innerHTML = `
                <span class="wsi-rank">${idx + 1}</span>
                <div class="wsi-main">
                    <span class="wsi-name">${escHtml(d.name)}</span>
                    <div class="wsi-sub">
                        <span class="wt-code">${escHtml(d.code)}</span>
                        <span class="wt-market ${marketClz}">${market}</span>
                        <span>지정일 ${escHtml(d.designatedDate)} · 해제일 ${escHtml(d.releasedCheckDate || '-')}</span>
                    </div>
                </div>
                <div class="wsi-prices">
                    <span class="wt-badge released" style="margin-bottom:4px;">해제완료</span>
                    <span class="wsi-designated">${d.designatedPrice.toLocaleString()}원</span>
                    <span class="wsi-release">해제기준 ${d.releaseMinPrice.toLocaleString()}원</span>
                </div>
                <i class="fa-solid fa-chevron-right wsi-arrow"></i>
            `;
            li.addEventListener('click', () => openDangerDetail(d));
            stockList.appendChild(li);
        });

        listWrap.classList.remove('hidden');
    } catch (err) {
        loadingBar.classList.add('hidden');
        emptyMsg.classList.remove('hidden');
        console.error('[Released Danger List Error]', err);
    }
}

// ── 투자위험 종목 상세 패널 열기 (공통 detail panel 재사용, /api/dangers/:code 호출) ──
async function openDangerDetail(stockBase) {
    showWarningDetail();

    document.getElementById('detailStockName').textContent = stockBase.name;
    document.getElementById('detailStockCode').textContent = stockBase.code;

    try {
        const res = await fetch(`/api/dangers/${stockBase.code}`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error);

        const d = data.items[0];
        const analysis = data.analysis || {};

        const marketBadge = document.getElementById('detailMarketBadge');
        const mkt = (d.market || '').toUpperCase();
        marketBadge.textContent = mkt;
        marketBadge.className = `wt-market ${mkt === 'KOSPI' ? 'kospi' : 'kosdaq'}`;

        document.getElementById('detailDesignatedDate').textContent = d.designatedDate;
        document.getElementById('detailDesignatedPrice').textContent = d.designatedPrice.toLocaleString() + '원';
        document.getElementById('detailReleasePrice').textContent = d.releaseMinPrice.toLocaleString() + '원';

        const tradingDays = data.tradingDaysElapsed ?? 0;

        const extendedNote = document.getElementById('extendedWarningNote');
        if (analysis.isExtended && analysis.extensionDays > 0) {
            extendedNote.innerHTML = `
                <div class="extended-alert">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <div>
                        <strong>투자위험 지정 연장됨 (${analysis.extensionDays}일째)</strong>
                        <p>해제 요건일(${analysis.firstExtendedDate})에 요건을 충족하지 못해 지정이 연장되었습니다.</p>
                    </div>
                </div>
            `;
            extendedNote.classList.remove('hidden');
        } else {
            extendedNote.classList.add('hidden');
        }

        renderReleaseConditions(d);

        const releaseStatCard = document.getElementById('detailDaysElapsed').parentElement;
        if (d.isReleased) {
            document.getElementById('detailDaysElapsed').innerHTML = `<span style="color:var(--success-color)">해제됨 (${d.releasedCheckDate})</span>`;
            releaseStatCard.classList.add('release');
        } else {
            document.getElementById('detailDaysElapsed').textContent = `D+${tradingDays}일 (영업일 기준 ${tradingDays}일 경과)`;
            releaseStatCard.classList.remove('release');
        }

        // 차트: /api/dangers/:code/chart 사용
        await loadDangerPriceChart(d);

    } catch (err) {
        console.error('[Danger Detail Panel Error]', err);
    }
}

async function loadDangerPriceChart(d) {
    const chartLoading = document.getElementById('detailChartLoading');
    const canvas = document.getElementById('warningPriceChart');
    chartLoading.classList.remove('hidden');
    canvas.style.display = 'none';

    if (warningChartInstance) {
        warningChartInstance.destroy();
        warningChartInstance = null;
    }

    try {
        const res = await fetch(`/api/dangers/${d.code}/chart`);
        const data = await res.json();
        chartLoading.classList.add('hidden');
        canvas.style.display = '';

        if (!data.prices || data.prices.length === 0) {
            chartLoading.textContent = '차트 데이터 없음';
            chartLoading.classList.remove('hidden');
            canvas.style.display = 'none';
            return;
        }

        const designatedYMD = d.designatedDate.replace(/-/g, '');
        const filtered = data.prices.filter(p => p.date >= designatedYMD);
        const chartData = filtered.length > 0 ? filtered : data.prices.slice(-30);

        const labels = chartData.map(p => `${p.date.slice(0, 4)}-${p.date.slice(4, 6)}-${p.date.slice(6, 8)}`);
        const closes = chartData.map(p => p.close);

        document.getElementById('detailChartRange').textContent = `${labels[0]} ~ ${labels[labels.length - 1]} (${labels.length}거래일)`;

        warningChartInstance = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: '종가',
                    data: closes,
                    borderColor: '#f85149',
                    backgroundColor: 'rgba(248, 81, 73, .1)',
                    borderWidth: 2,
                    tension: 0.2,
                    fill: true,
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false },
                    annotation: {
                        annotations: {
                            designatedLine: {
                                type: 'line',
                                yMin: d.designatedPrice,
                                yMax: d.designatedPrice,
                                borderColor: 'rgba(210, 153, 34, 0.7)',
                                borderDash: [5, 5],
                                label: { display: true, content: '지정가', position: 'end' }
                            },
                            releaseLine: {
                                type: 'line',
                                yMin: d.releaseMinPrice,
                                yMax: d.releaseMinPrice,
                                borderColor: 'rgba(248, 81, 73, 0.7)',
                                borderDash: [5, 5],
                                label: { display: true, content: '해제기준', position: 'end' }
                            }
                        }
                    }
                },
                scales: {
                    y: { ticks: { callback: v => v.toLocaleString() } }
                }
            }
        });
    } catch (err) {
        chartLoading.textContent = '차트 로드 실패';
        console.error(err);
    }
}

// ── 종목 상세 패널 열기 ────────────────────────────────────
let warningChartInstance = null;

async function openWarningDetail(stockBase) {
    showWarningDetail();

    // 초기 로딩 상태
    document.getElementById('detailStockName').textContent = stockBase.name;
    document.getElementById('detailStockCode').textContent = stockBase.code;

    try {
        const res = await fetch(`/api/warnings/${stockBase.code}`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error);

        const w = data.items[0];
        const analysis = data.analysis || {};

        // 헤더 & 기본 정보
        const marketBadge = document.getElementById('detailMarketBadge');
        const mkt = (w.market || '').toUpperCase();
        marketBadge.textContent = mkt;
        marketBadge.className = `wt-market ${mkt === 'KOSPI' ? 'kospi' : 'kosdaq'}`;

        document.getElementById('detailDesignatedDate').textContent = w.designatedDate;
        document.getElementById('detailDesignatedPrice').textContent = w.designatedPrice.toLocaleString() + '원';
        document.getElementById('detailReleasePrice').textContent = w.releaseMinPrice.toLocaleString() + '원';

        const tradingDays = data.tradingDaysElapsed ?? Math.floor((new Date() - new Date(w.designatedDate)) / (1000 * 60 * 60 * 24));
        document.getElementById('detailDaysElapsed').textContent = `D+${tradingDays}일 (영업일 기준 ${tradingDays}일 경과)`;

        // 투자경고 연장 알림
        const extendedNote = document.getElementById('extendedWarningNote');
        if (analysis.isExtended && analysis.extensionDays > 0) {
            extendedNote.innerHTML = `
                <div class="extended-alert">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <div>
                        <strong>투자경고 지정 연장됨 (${analysis.extensionDays}일째)</strong>
                        <p>해제 요건일(${analysis.firstExtendedDate})에 요건을 충족하지 못해 지정이 연장되었습니다. (현재 ${analysis.extensionDays}영업일 경과)</p>
                    </div>
                </div>
            `;
            extendedNote.classList.remove('hidden');
        } else {
            extendedNote.classList.add('hidden');
        }

        renderReleaseConditions(w);

        // 해제됨 표시 (신규)
        const releaseStatCard = document.getElementById('detailDaysElapsed').parentElement;
        if (w.isReleased) {
            document.getElementById('detailDaysElapsed').innerHTML = `<span style="color:var(--success-color)">해제됨 (${w.releasedCheckDate})</span>`;
            releaseStatCard.classList.add('release'); // 녹색 배경 효과 재활용하거나 별도 스타일
        } else {
            const tradingDays = data.tradingDaysElapsed ?? Math.floor((new Date() - new Date(w.designatedDate)) / (1000 * 60 * 60 * 24));
            document.getElementById('detailDaysElapsed').textContent = `D+${tradingDays}일 (영업일 기준 ${tradingDays}일 경과)`;
            releaseStatCard.classList.remove('release');
        }

        await loadPriceChart(w);

    } catch (err) {
        console.error('[Detail Panel Error]', err);
    }
}

function renderReleaseConditions(w) {
    const multiplier5 = w.releaseType === 'unsound' ? 1.45 : 1.60;
    const multiplier15 = w.releaseType === 'unsound' ? 1.75 : 2.00;
    const threshold5 = Math.ceil(w.designatedPrice * multiplier5);
    const threshold15 = Math.ceil(w.designatedPrice * multiplier15);
    const typeLabel = w.releaseType === 'unsound' ? '불건전형' : '일반형';

    document.getElementById('detailReleaseConditions').innerHTML = `
        <div class="release-row">
            <div><div class="release-row-label">해제 유형</div></div>
            <span class="release-row-val">${typeLabel}</span>
        </div>
        <div class="release-row">
            <div><div class="release-row-label">T-5 종가 유지 조건 (추정)</div></div>
            <span class="release-row-val">${threshold5.toLocaleString()}원 이상</span>
        </div>
        <div class="release-row">
            <div><div class="release-row-label">T-15 종가 유지 조건 (추정)</div></div>
            <span class="release-row-val">${threshold15.toLocaleString()}원 이상</span>
        </div>
        <div class="release-row">
            <div><div class="release-row-label">해제 기준가 (최솟값)</div></div>
            <span class="release-row-val">${w.releaseMinPrice.toLocaleString()}원</span>
        </div>
    `;
}

async function loadPriceChart(w) {
    const chartLoading = document.getElementById('detailChartLoading');
    const canvas = document.getElementById('warningPriceChart');
    chartLoading.classList.remove('hidden');
    canvas.style.display = 'none';

    if (warningChartInstance) {
        warningChartInstance.destroy();
        warningChartInstance = null;
    }

    try {
        const res = await fetch(`/api/warnings/${w.code}/chart`);
        const data = await res.json();
        chartLoading.classList.add('hidden');
        canvas.style.display = '';

        if (!data.prices || data.prices.length === 0) {
            chartLoading.textContent = '차트 데이터 없음';
            chartLoading.classList.remove('hidden');
            canvas.style.display = 'none';
            return;
        }

        const designatedYMD = w.designatedDate.replace(/-/g, '');
        const filtered = data.prices.filter(p => p.date >= designatedYMD);
        const chartData = filtered.length > 0 ? filtered : data.prices.slice(-30);

        const labels = chartData.map(p => `${p.date.slice(0, 4)}-${p.date.slice(4, 6)}-${p.date.slice(6, 8)}`);
        const closes = chartData.map(p => p.close);

        document.getElementById('detailChartRange').textContent = `${labels[0]} ~ ${labels[labels.length - 1]} (${labels.length}거래일)`;

        warningChartInstance = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: '종가',
                    data: closes,
                    borderColor: '#58a6ff',
                    backgroundColor: 'rgba(88, 166, 255, .1)',
                    borderWidth: 2,
                    tension: 0.2,
                    fill: true,
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false },
                    annotation: {
                        annotations: {
                            designatedLine: {
                                type: 'line',
                                yMin: w.designatedPrice,
                                yMax: w.designatedPrice,
                                borderColor: 'rgba(210, 153, 34, 0.7)',
                                borderDash: [5, 5],
                                label: { display: true, content: '지정가', position: 'end' }
                            },
                            releaseLine: {
                                type: 'line',
                                yMin: w.releaseMinPrice,
                                yMax: w.releaseMinPrice,
                                borderColor: 'rgba(248, 81, 73, 0.7)',
                                borderDash: [5, 5],
                                label: { display: true, content: '해제기준', position: 'end' }
                            }
                        }
                    }
                },
                scales: {
                    y: { ticks: { callback: v => v.toLocaleString() } }
                }
            }
        });
    } catch (err) {
        chartLoading.textContent = '차트 로드 실패';
        console.error(err);
    }
}

function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

