import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Run archive script every day at midnight (00:00)
cron.schedule('0 0 * * *', async () => {
  console.log(`[CronArchive] Starting daily archive at ${new Date().toISOString()}`);
  
  try {
    const { stdout, stderr } = await execAsync('npm run archive-old');
    console.log('[CronArchive] Archive completed successfully');
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (error) {
    console.error('[CronArchive] Archive failed:', error.message);
  }
}, {
  timezone: 'Asia/Kolkata'
});

console.log('[CronArchive] Daily archive cron job scheduled at midnight IST');

export default true;
