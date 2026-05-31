const cron = require('node-cron');
const { processOnce } = require('./process_recurring');

console.log('Starting recurring orders scheduler (runs hourly)');

// Run immediately once
processOnce();

// Schedule to run hourly at minute 0
cron.schedule('0 * * * *', () => {
  console.log('Running scheduled recurring orders check:', new Date().toISOString());
  processOnce();
});

// keep process alive
process.stdin.resume();
