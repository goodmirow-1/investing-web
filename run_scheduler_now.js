const { runOnce, runReleaseCheck } = require('./src/kokstock_scheduler');

async function main() {
    console.log('=== 강제 스케줄러 실행 시작 ===');
    await runOnce();
    await runReleaseCheck();
    console.log('=== 강제 스케줄러 실행 종료 ===');
    process.exit(0);
}

main();
