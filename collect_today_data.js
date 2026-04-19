const { scrapeKokstockWarnings } = require('./src/kokstock_scraper');
const { fetchStockData } = require('./src/api');
const fs = require('fs');

(async () => {
    try {
        console.log('--- Step 1: Scraping Warning Stocks from Kokstock ---');
        const warningStocks = await scrapeKokstockWarnings();
        console.log(`Found ${warningStocks.length} stocks.`);

        console.log('--- Step 2: Fetching detailed analysis for each stock ---');
        const results = [];
        for (const stock of warningStocks) {
            console.log(`Analyzing ${stock.name} (${stock.code})...`);
            try {
                const detailedData = await fetchStockData(stock.code);
                results.push(detailedData);
            } catch (err) {
                console.error(`Failed to analyze ${stock.name}: ${err.message}`);
                results.push({
                    ticker: stock.code,
                    stockName: stock.name,
                    error: err.message
                });
            }
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const output = {
            date: new Date().toISOString().split('T')[0],
            count: results.length,
            stocks: results
        };

        fs.writeFileSync('today_warning_stocks.json', JSON.stringify(output, null, 2));
        console.log('--- COMPLETED ---');
        console.log('Results saved to today_warning_stocks.json');

        // Print names of stocks met criteria if possible
        const criteriaMet = results.filter(s => s.overheat && (s.overheat.criteriaMet.price || s.overheat.criteriaMet.turnover || s.overheat.criteriaMet.volatility));
        console.log(`Stocks meeting some overheating criteria: ${criteriaMet.length}`);
        criteriaMet.forEach(s => console.log(`- ${s.stockName} (${s.ticker})`));

    } catch (error) {
        console.error('CRITICAL ERROR:', error.message);
    }
})();
