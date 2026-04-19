/**
 * recollect_all.js
 * 투자경고 전체 데이터 재수집 (초기화 + 재수집)
 * - warning_history.json 초기화 후 kokstock.com에서 전체 재수집
 * - 실행: node recollect_all.js
 */
const axios = require('axios');
const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'warning_history.json');
const STATUS_FILE = path.join(__dirname, 'data', 'release_check_history.json');

const BASE_HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Referer': 'https://www.google.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'Cookie': 'ASPSESSIONIDQACDSCQB=CCJJFLHCALOIONAEDCHJLHGN; _fwb=52PzIgMgbD2MZao5i74Ocl.1776090912962; _gcl_au=1.1.1794373148.1776090913; ASPSESSIONIDSABCQDQB=LONJDDBACLJCKFBCMACAHAHO; ASPSESSIONIDSCCDTDTA=ADEBCPNAHJDKEJKJAHEJLPAB; _gid=GA1.2.1772870441.1776478167; _ga_M2696TQZYD=GS2.1.s1776478167$o4$g1$t1776478706$j52$l0$h0; wcs_bt=s_17cd9ae5d519:1776478706; _ga_4E1ESLDREP=GS2.1.s1776478167$o4$g1$t1776478706$j52$l0$h0; _ga=GA1.2.1571810397.1776090913'
};

const parsePrice = (val) => parseInt(String(val).replace(/,/g, ''), 10);

function parsePage(html) {
    const stocks = [];
    const rowRegex = /<tr>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
        const row = rowMatch[1];
        const codeMatch = /data-cd='([0-9]{6})'/.exec(row);
        if (!codeMatch) continue;
        const code = codeMatch[1];

        let designatedDate = null;
        const dateMatch = /<td[^>]*title='\[([0-9]{4}-[0-9]{2}-[0-9]{2})~\] 투자경고'/.exec(row);
        if (dateMatch) {
            designatedDate = dateMatch[1];
        } else {
            const fDateMatch = /<td[^>]*class='[^']*fDate[^']*'[^\>]*>([0-9]{4}-[0-9]{2}-[0-9]{2})<\/td>/.exec(row);
            if (fDateMatch) designatedDate = fDateMatch[1];
        }
        if (!designatedDate) continue;
        const nmMatch = /data-cd='[0-9]{6}'\s+data-nm='([^']+)'/.exec(row);
        const name = nmMatch ? nmMatch[1].trim() : code;
        let market = 'KOSDAQ';
        if (/KOSPI/i.test(row)) market = 'KOSPI';
        stocks.push({ code, name, market, designatedDate });
    }
    return stocks;
}

async function scrapePage(page) {
    const url = `https://www.kokstock.com/stock/statusC.asp?page=${page}&pagesize=20`;
    const response = await axios.get(url, {
        headers: BASE_HEADERS,
        responseType: 'arraybuffer',
        timeout: 12000
    });
    const html = iconv.decode(response.data, 'euc-kr');
    return parsePage(html);
}

async function fetchPrice(code) {
    try {
        const url = `https://m.stock.naver.com/api/stock/${code}/basic`;
        const res = await axios.get(url, { timeout: 8000 });
        if (res.data && res.data.closePrice) {
            return parsePrice(res.data.closePrice);
        }
    } catch (e) { /* ignore */ }
    return null;
}

function computeReleaseInfo(price) {
    // 기본 일반형
    return {
        releaseType: 'normal',
        releaseMinPrice: Math.ceil(price * 2.0),
        releaseDetail: '지정가 × 200% (일반형: T-5 60%↑, T-15 100%↑ 동시 불충족 시 해제)'
    };
}

async function main() {
    console.log('=== 투자경고 전체 데이터 재수집 시작 ===\n');

    // 1. 기존 데이터 초기화
    fs.writeFileSync(DATA_FILE, '[]', 'utf8');
    fs.writeFileSync(STATUS_FILE, '[]', 'utf8');
    console.log('✓ 기존 데이터 초기화 완료\n');

    // 2. 전체 페이지 수집 (최대 15페이지 = 300개)
    const allStocks = [];
    const seen = new Set();

    for (let page = 1; page <= 15; page++) {
        try {
            const stocks = await scrapePage(page);
            console.log(`페이지 ${page}: ${stocks.length}개 종목 발견`);
            if (stocks.length === 0) {
                console.log(`  → 더 이상 데이터 없음. 수집 종료.`);
                break;
            }
            for (const s of stocks) {
                if (!seen.has(s.code)) {
                    seen.add(s.code);
                    allStocks.push(s);
                }
            }
        } catch (e) {
            console.error(`  → 페이지 ${page} 실패: ${e.message}`);
            break;
        }
        await new Promise(r => setTimeout(r, 600));
    }

    console.log(`\n총 ${allStocks.length}개 종목 수집 완료\n`);

    // 3. 각 종목 지정가 조회 (Naver API)
    const warnings = [];
    console.log('지정가 조회 중 (Naver API)...');
    for (const stock of allStocks) {
        const price = await fetchPrice(stock.code);
        if (!price) {
            console.log(`  SKIP ${stock.name} (${stock.code}): 가격 조회 실패`);
            continue;
        }
        const releaseInfo = computeReleaseInfo(price);
        warnings.push({
            code: stock.code,
            name: stock.name,
            market: stock.market,
            designatedDate: stock.designatedDate,
            designatedPrice: price,
            releaseType: releaseInfo.releaseType,
            releaseMinPrice: releaseInfo.releaseMinPrice,
            releaseDetail: releaseInfo.releaseDetail,
            addedAt: new Date().toISOString()
        });
        console.log(`  ✓ ${stock.name} (${stock.code}) - 지정일: ${stock.designatedDate}, 지정가: ${price.toLocaleString()}원, 해제기준가: ${releaseInfo.releaseMinPrice.toLocaleString()}원`);
        await new Promise(r => setTimeout(r, 300));
    }

    // 4. 저장
    fs.writeFileSync(DATA_FILE, JSON.stringify(warnings, null, 2), 'utf8');
    console.log(`\n=== 재수집 완료: ${warnings.length}개 종목 저장 ===`);
}

main().catch(console.error);
