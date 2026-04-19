const { scrapeKokstockWarnings } = require('./src/kokstock_scraper');

(async () => {
    try {
        console.log('Starting Scrape...');
        const stocks = await scrapeKokstockWarnings();
        console.log('Found Stocks:', stocks.length);
        console.log(JSON.stringify(stocks, null, 2));
    } catch (error) {
        console.error('FAILED:', error.message);
    }
})();
