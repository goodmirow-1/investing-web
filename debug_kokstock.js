/**
 * Debug: check page 2 of kokstock for designation date pattern
 */
const axios = require('axios');
const iconv = require('iconv-lite');
const fs = require('fs');

async function main() {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        'Accept-Language': 'ko,en-US;q=0.9,en;q=0.8',
        'Cookie': 'ASPSESSIONIDQACDSCQB=CCJJFLHCALOIONAEDCHJLHGN; _fwb=52PzIgMgbD2MZao5i74Ocl.1776090912962; _gcl_au=1.1.1794373148.1776090913; ASPSESSIONIDSABCQDQB=LONJDDBACLJCKFBCMACAHAHO; ASPSESSIONIDSCCDTDTA=ADEBCPNAHJDKEJKJAHEJLPAB; _gid=GA1.2.1772870441.1776478167; wcs_bt=s_17cd9ae5d519:1776478706; _ga=GA1.2.1571810397.1776090913'
    };

    for (const page of [1, 2]) {
        const url = `https://www.kokstock.com/stock/statusC.asp?page=${page}&pagesize=20`;
        const res = await axios.get(url, { headers, responseType: 'arraybuffer', timeout: 10000 });
        const html = iconv.decode(res.data, 'euc-kr');

        // Find a row context
        const idx = html.indexOf("data-cd='");
        if (idx !== -1) {
            const ctx = html.substring(Math.max(0, idx - 500), Math.min(html.length, idx + 800));
            fs.writeFileSync(`debug_page${page}.txt`, ctx);
            console.log(`Page ${page}: wrote debug_page${page}.txt, found data-cd`);
        } else {
            console.log(`Page ${page}: no data-cd found`);
            fs.writeFileSync(`debug_page${page}.txt`, html.substring(0, 3000));
        }
        await new Promise(r => setTimeout(r, 500));
    }
}
main().catch(console.error);
