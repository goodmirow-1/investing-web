const axios = require('axios');

async function checkNaver() {
    const ticker = '012205'; // 계양전기우
    const url = `https://m.stock.naver.com/api/stock/${ticker}/basic`;
    try {
        const res = await axios.get(url);
        console.log('Stock Name:', res.data.stockName);
        console.log('Market Alert Type:', res.data.marketAlertType);
        console.log('Close Price:', res.data.closePrice);
    } catch (e) {
        console.error(e.message);
    }
}

checkNaver();
