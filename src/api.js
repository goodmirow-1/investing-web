const axios = require('axios');
const NodeCache = require('node-cache');

// Cache: 5분(300초) TTL
const cache = new NodeCache({ stdTTL: 300 });

const parsePrice = (val) => parseInt(String(val).replace(/,/g, ''), 10);

async function fetchStockData(ticker) {
    // --- 실시간 Naver 기본 정보 호출 ---
    const basicUrl = `https://m.stock.naver.com/api/stock/${ticker}/basic`;
    const basicRes = await axios.get(basicUrl, { timeout: 8000 });
    const currentData = basicRes.data;

    if (!currentData || !currentData.closePrice) {
        const err = new Error('Stock not found');
        err.status = 404;
        throw err;
    }

    const currentPrice = parsePrice(currentData.closePrice);
    const stockName = currentData.stockName || ticker;

    // --- 과거 주가 데이터 캐시 처리 (history만 캐싱) ---
    const historyCacheKey = `history_${ticker}`;
    let historicalData = cache.get(historyCacheKey);

    if (!historicalData) {
        // 5페이지 x 60개 = 최대 300영업일 (약 1년치 역사적 주가 데이터 수집)
        const pages = [1, 2, 3, 4, 5];
        const priceResponses = await Promise.all(
            pages.map(page => axios.get(`https://m.stock.naver.com/api/stock/${ticker}/price?pageSize=60&page=${page}`, { timeout: 8000 }).catch(e => ({ data: [] })))
        );
        historicalData = [];
        for (const res of priceResponses) {
            if (res.data && Array.isArray(res.data)) {
                historicalData = historicalData.concat(res.data);
            }
        }

        if (!Array.isArray(historicalData) || historicalData.length < 42) {
            const err = new Error('Failed to fetch sufficient historical data (need 42+ days)');
            err.status = 500;
            throw err;
        }
        cache.set(historyCacheKey, historicalData);
    }

    // ── 실시간 가격으로 데이터 교체 ──
    // 캐시된 데이터라도 [0](오늘) 데이터를 실시간 가격/거래량으로 덮어씌워서 계산
    historicalData = [...historicalData];
    historicalData[0] = {
        ...historicalData[0],
        closePrice: currentData.closePrice,
        openPrice: currentData.openPrice || historicalData[0].openPrice,
        highPrice: currentData.highPrice || historicalData[0].highPrice,
        lowPrice: currentData.lowPrice || historicalData[0].lowPrice,
        accumulatedTradingVolume: typeof currentData.accumulatedTradingVolume !== 'undefined'
            ? parsePrice(currentData.accumulatedTradingVolume)
            : historicalData[0].accumulatedTradingVolume
    };

    // --- 가격 데이터 계산 ---
    const getPriceAtAgo = (days) => {
        if (historicalData.length > days) return parsePrice(historicalData[days].closePrice);
        return parsePrice(historicalData[historicalData.length - 1].closePrice);
    };

    const pricePrevDay = getPriceAtAgo(1);
    const price3DaysAgo = getPriceAtAgo(3);
    const price5DaysAgo = getPriceAtAgo(5);
    const price15DaysAgo = getPriceAtAgo(15);
    const price1YearAgo = getPriceAtAgo(252); // 약 1년치 영업일 기준

    // 40일 평균 종가 (어제~40일전)
    const prices40 = historicalData.slice(1, 41).map(d => parsePrice(d.closePrice));
    const avgClose40 = prices40.reduce((a, b) => a + b, 0) / prices40.length;

    // 단기과열: 거래량 회전율 비율
    const volumesRecent2 = historicalData.slice(0, 2).map(d => d.accumulatedTradingVolume);
    const avgVolRecent2 = volumesRecent2.reduce((a, b) => a + b, 0) / 2;
    const volumesPrev40 = historicalData.slice(2, 42).map(d => d.accumulatedTradingVolume);
    const avgVolPrev40 = volumesPrev40.reduce((a, b) => a + b, 0) / volumesPrev40.length;
    const turnoverRatio = (avgVolRecent2 / avgVolPrev40) * 100;

    // 단기과열: 변동성 비율
    const getVolatility = (day) => {
        const high = parsePrice(day.highPrice);
        const low = parsePrice(day.lowPrice);
        const close = parsePrice(day.closePrice);
        return (high - low) / close;
    };
    const avgVolatRecent2 = historicalData.slice(0, 2).map(getVolatility).reduce((a, b) => a + b, 0) / 2;
    const avgVolatPrev40 = historicalData.slice(2, 42).map(getVolatility).reduce((a, b) => a + b, 0) / 40;
    const volatilityRatio = (avgVolatRecent2 / avgVolatPrev40) * 100;

    // 단기과열: 주가 상승률
    const priceIncreaseRate = (currentPrice / avgClose40) * 100;

    // 15일 상승일수
    let risingDays15 = 0;
    for (let i = 0; i < Math.min(15, historicalData.length); i++) {
        const day = historicalData[i];
        if (parsePrice(day.closePrice) > parsePrice(day.openPrice)) risingDays15++;
    }

    // 종가 급변 여부
    const priceChangePct = Math.abs((currentPrice - pricePrevDay) / pricePrevDay) * 100;
    const totalVolume = historicalData[0].accumulatedTradingVolume;
    const isClosingSudden = priceChangePct >= 5 && totalVolume >= 30000;

    // 15일 이전 최고가 (어제~15일전)
    const getPrevMax = (days) => {
        const prevPrices = historicalData.slice(1, days + 1).map(d => parsePrice(d.closePrice));
        return Math.max(...prevPrices);
    };
    const prevMax15 = getPrevMax(15);

    // 경고/주의 목표가
    const warningTargets = {
        ultraShort: Math.max(price3DaysAgo * 2.0, prevMax15),
        short: Math.max(price5DaysAgo * 1.6, prevMax15),
        midLong: Math.max(price15DaysAgo * 2.0, prevMax15),
        cautionRep: Math.max(price15DaysAgo * 1.75, prevMax15),
        shortUnsound: Math.max(price5DaysAgo * 1.45, prevMax15),
        midLongUnsound: Math.max(price15DaysAgo * 1.75, prevMax15),
        longUnsound: Math.max(price1YearAgo * 3.0, prevMax15),
        cautionPrice3d: price3DaysAgo * 1.15,
        cautionPrice15d: price15DaysAgo * 1.75,
        overheating40d: avgClose40 * 1.3
    };

    const result = {
        ticker,
        stockName,
        currentPrice,
        totalVolume,
        priceChangePct: priceChangePct.toFixed(2),
        historicalPrices: {
            ago1: pricePrevDay,
            ago3: price3DaysAgo,
            ago5: price5DaysAgo,
            ago15: price15DaysAgo,
            avg40: Math.floor(avgClose40)
        },
        overheat: {
            priceIncreaseRate: priceIncreaseRate.toFixed(2),
            turnoverRatio: turnoverRatio.toFixed(2),
            volatilityRatio: volatilityRatio.toFixed(2),
            criteriaMet: {
                price: priceIncreaseRate >= 130,
                turnover: turnoverRatio >= 600,
                volatility: volatilityRatio >= 150
            }
        },
        stats: {
            risingDays15,
            isClosingSudden,
            is15DayHigh: currentPrice >= prevMax15,
            max15Price: prevMax15,
            price1YearAgo,
            increaseRate1Year: (((currentPrice - price1YearAgo) / price1YearAgo) * 100).toFixed(2),
            is200Pct1Year: (((currentPrice - price1YearAgo) / price1YearAgo) * 100) > 200
        },
        warningTargets,
        marketAlert: currentData.marketAlertType ? currentData.marketAlertType.text : null,
        cachedAt: new Date().toISOString()
    };

    return result;
}

module.exports = { fetchStockData };
