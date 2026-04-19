/**
 * kokstock_scraper.js
 * 코크스탁 투자경고 페이지 스크래핑 (1~2 페이지)
 */
const axios = require('axios');
const iconv = require('iconv-lite');

const BASE_HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'ko,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'max-age=0',
    'Connection': 'keep-alive',
    'Referer': 'https://www.google.com/',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Cookie': 'ASPSESSIONIDQACDSCQB=CCJJFLHCALOIONAEDCHJLHGN; _fwb=52PzIgMgbD2MZao5i74Ocl.1776090912962; _gcl_au=1.1.1794373148.1776090913; ASPSESSIONIDSABCQDQB=LONJDDBACLJCKFBCMACAHAHO; ASPSESSIONIDSCCDTDTA=ADEBCPNAHJDKEJKJAHEJLPAB; _gid=GA1.2.1772870441.1776478167; _ga_M2696TQZYD=GS2.1.s1776478167$o4$g1$t1776478706$j52$l0$h0; wcs_bt=s_17cd9ae5d519:1776478706; _ga_4E1ESLDREP=GS2.1.s1776478167$o4$g1$t1776478706$j52$l0$h0; _ga=GA1.2.1571810397.1776090913'
};

/**
 * 단일 페이지에서 투자경고 종목 추출
 * 반환: [{ code, name, market, designatedDate }]
 *
 * HTML 구조 (핵심 부분):
 *   <span class='...KOSDAQ...'>KOSDAQ</span>   ← 시장
 *   <span ... data-cd='038060' data-nm='루멘스' ...>테</span>  ← 코드/종목명
 *   <td ... data-cd='038060' data-dt='2026-04-17' ...>          ← 지정일(data-dt)
 */
function parsePage(html) {
    const stocks = [];

    // 행 단위로 파싱: <tr>...</tr> 블록 각각에서 정보를 추출
    // data-dt 속성이 있는 셀: data-cd='XXXXXX' data-dt='YYYY-MM-DD'
    // data-nm 속성이 있는 span(종목명): data-cd='XXXXXX' data-nm='종목명'
    // 시장 구분: KOSDAQ 또는 KOSPI 텍스트가 있는 span

    // 지정일 포함 td 패턴
    const rowRegex = /<tr>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
        const row = rowMatch[1];

        // 종목코드 + 지정일
        const codeMatch = /data-cd='([0-9]{6})'/.exec(row);
        if (!codeMatch) continue;
        const code = codeMatch[1];

        // 올바른 지정일 추출 ('[YYYY-MM-DD~] 투자경고' title 또는 fDate 클래스)
        let designatedDate = null;
        const dateMatch = /<td[^>]*title='\[([0-9]{4}-[0-9]{2}-[0-9]{2})~\] 투자경고'/.exec(row);
        if (dateMatch) {
            designatedDate = dateMatch[1];
        } else {
            const fDateMatch = /<td[^>]*class='[^']*fDate[^']*'[^\>]*>([0-9]{4}-[0-9]{2}-[0-9]{2})<\/td>/.exec(row);
            if (fDateMatch) designatedDate = fDateMatch[1];
        }
        if (!designatedDate) continue;

        // 종목명
        const nmMatch = /data-cd='[0-9]{6}'\s+data-nm='([^']+)'/.exec(row);
        const name = nmMatch ? nmMatch[1].trim() : code;

        // 시장 (KOSDAQ / KOSPI)
        let market = 'KOSDAQ';
        if (/KOSPI/i.test(row)) market = 'KOSPI';
        else if (/KOSDAQ/i.test(row)) market = 'KOSDAQ';

        stocks.push({ code, name, market, designatedDate });
    }

    return stocks;
}

/**
 * 1~2 페이지 스크래핑 (정기 수집용, 페이지당 20개씩)
 * 반환: [{ code, name, market, designatedDate }] (중복 제거)
 */
async function scrapeKokstockWarnings() {
    const allStocks = [];
    const seen = new Set();

    // 정기 수집은 1, 2페이지만 조회 (페이지당 20개)
    for (const page of [1, 2]) {
        const url = `https://www.kokstock.com/stock/statusC.asp?page=${page}&pagesize=20`;
        try {
            const response = await axios.get(url, {
                headers: BASE_HEADERS,
                responseType: 'arraybuffer',
                timeout: 10000
            });
            const html = iconv.decode(response.data, 'euc-kr');
            const pageStocks = parsePage(html);
            console.log(`[Scraper] Page ${page}: found ${pageStocks.length} stocks`);

            if (pageStocks.length === 0) break;

            for (const stock of pageStocks) {
                if (!seen.has(stock.code)) {
                    seen.add(stock.code);
                    allStocks.push(stock);
                }
            }
        } catch (err) {
            console.error(`[Scraper] Page ${page} failed: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 500));
    }

    return allStocks;
}

module.exports = { scrapeKokstockWarnings };
