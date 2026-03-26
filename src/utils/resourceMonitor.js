// System resource monitoring for large campaigns
let monitoringActive = false;

export const startResourceMonitoring = () => {
  if (monitoringActive) return;
  
  monitoringActive = true;
  console.log('🔍 Starting resource monitoring...');
  
  const interval = setInterval(() => {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const memTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    
    // Only log if memory usage is significant
    if (memUsedMB > 500) {
      console.log(`[Monitor] Memory: ${memUsedMB}MB/${memTotalMB}MB | CPU: ${Math.round(cpuUsage.user/1000)}ms`);
    }
    
    // Alert on high memory usage
    if (memUsedMB > 1500) {
      console.warn(`⚠️ High memory usage: ${memUsedMB}MB - Consider restarting after campaign completion`);
    }
  }, 30000); // Every 30 seconds
  
  // Auto-stop after 30 minutes
  setTimeout(() => {
    clearInterval(interval);
    monitoringActive = false;
    console.log('✅ Resource monitoring stopped');
  }, 30 * 60 * 1000);
};

// Start monitoring when large campaigns begin
if (process.env.NODE_ENV === 'production') {
  startResourceMonitoring();
}