const axios = require('axios');
const NodeCache = require('node-cache');

// Cache: 5분(300초) TTL
const cache = new NodeCache({ stdTTL: 300 });

const parsePrice = (val) => parseInt(String(val).replace(/,/g, ''), 10);

async function fetchStockData(ticker) {
    const cacheKey = `stock_${ticker}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return cached;
    }

    // --- Naver API 호출 ---
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

    const priceUrl = `https://m.stock.naver.com/api/stock/${ticker}/price?pageSize=60&page=1`;
    const priceRes = await axios.get(priceUrl, { timeout: 8000 });
    const historicalData = priceRes.data;

    if (!Array.isArray(historicalData) || historicalData.length < 42) {
        const err = new Error('Failed to fetch sufficient historical data (need 42+ days)');
        err.status = 500;
        throw err;
    }

    // --- 가격 데이터 계산 ---
    const getPriceAtAgo = (days) => {
        if (historicalData.length > days) return parsePrice(historicalData[days].closePrice);
        return parsePrice(historicalData[historicalData.length - 1].closePrice);
    };

    const pricePrevDay = getPriceAtAgo(1);
    const price3DaysAgo = getPriceAtAgo(3);
    const price5DaysAgo = getPriceAtAgo(5);
    const price15DaysAgo = getPriceAtAgo(15);

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
            max15Price: prevMax15
        },
        warningTargets,
        marketAlert: currentData.marketAlertType ? currentData.marketAlertType.text : null,
        cachedAt: new Date().toISOString()
    };

    cache.set(cacheKey, result);
    return result;
}

module.exports = { fetchStockData };
