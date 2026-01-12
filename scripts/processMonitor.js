#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const EXPECTED_PROCESSES = [
  { name: 'api', instances: 1, type: 'API Server' },
  { name: 'kafka-consumer-1', instances: 1, type: 'Webhook Processing' },
  { name: 'kafka-consumer-2', instances: 1, type: 'Webhook Processing' },
  { name: 'kafka-consumer-3', instances: 1, type: 'Webhook Processing' },
  { name: 'stats-consumer', instances: 3, type: 'Stats Processing' },
  { name: 'batch-entries-consumer', instances: 2, type: 'Batch Processing' },
  { name: 'log-processor', instances: 1, type: 'Log Processing' }
];

async function checkPM2Processes() {
  console.log('🔍 Checking PM2 processes...\n');
  
  try {
    const { stdout } = await execAsync('pm2 jlist');
    const processes = JSON.parse(stdout);
    
    console.log('📋 Current PM2 Processes:');
    console.log('=========================');
    
    const processMap = new Map();
    processes.forEach(proc => {
      const name = proc.name;
      if (!processMap.has(name)) {
        processMap.set(name, []);
      }
      processMap.get(name).push(proc);
    });
    
    let allHealthy = true;
    
    for (const expected of EXPECTED_PROCESSES) {
      const running = processMap.get(expected.name) || [];
      const runningCount = running.filter(p => p.pm2_env.status === 'online').length;
      const stoppedCount = running.filter(p => p.pm2_env.status === 'stopped').length;
      const errorCount = running.filter(p => p.pm2_env.status === 'errored').length;
      
      const status = runningCount === expected.instances ? '✅' : '❌';
      const health = runningCount === expected.instances ? 'HEALTHY' : 'UNHEALTHY';
      
      console.log(`${status} ${expected.name.padEnd(25)} | ${expected.type.padEnd(20)} | Running: ${runningCount}/${expected.instances} | Stopped: ${stoppedCount} | Errors: ${errorCount}`);
      
      if (runningCount !== expected.instances) {
        allHealthy = false;
        
        // Show detailed status for problematic processes
        running.forEach(proc => {
          if (proc.pm2_env.status !== 'online') {
            console.log(`   └─ Instance ${proc.pm2_env.pm_id}: ${proc.pm2_env.status} (Restarts: ${proc.pm2_env.restart_time})`);
          }
        });
      }
    }
    
    // Check for unexpected processes
    const expectedNames = new Set(EXPECTED_PROCESSES.map(p => p.name));
    const unexpectedProcesses = Array.from(processMap.keys()).filter(name => !expectedNames.has(name));
    
    if (unexpectedProcesses.length > 0) {
      console.log('\n⚠️  Unexpected processes found:');
      unexpectedProcesses.forEach(name => {
        console.log(`   - ${name}`);
      });
    }
    
    console.log('\n📊 Process Monitor Summary:');
    console.log('===========================');
    console.log(`🎯 Overall Status: ${allHealthy ? '✅ ALL PROCESSES HEALTHY' : '❌ PROCESS ISSUES DETECTED'}`);
    
    if (!allHealthy) {
      console.log('\n🔧 Suggested Actions:');
      console.log('- Run: pm2 restart all');
      console.log('- Check logs: pm2 logs');
      console.log('- Monitor: pm2 monit');
    }
    
    return allHealthy;
    
  } catch (error) {
    console.error('❌ Failed to check PM2 processes:', error.message);
    
    if (error.message.includes('pm2: command not found')) {
      console.log('\n💡 PM2 is not installed or not in PATH');
      console.log('Install with: npm install -g pm2');
    }
    
    return false;
  }
}

async function checkProcessResources() {
  console.log('\n🔍 Checking Process Resources...\n');
  
  try {
    const { stdout } = await execAsync('pm2 jlist');
    const processes = JSON.parse(stdout);
    
    console.log('💾 Resource Usage:');
    console.log('==================');
    
    let totalMemory = 0;
    let totalCPU = 0;
    
    processes.forEach(proc => {
      const memory = Math.round(proc.monit.memory / 1024 / 1024); // MB
      const cpu = proc.monit.cpu;
      
      totalMemory += memory;
      totalCPU += cpu;
      
      const status = proc.pm2_env.status === 'online' ? '🟢' : '🔴';
      console.log(`${status} ${proc.name.padEnd(25)} | Memory: ${memory.toString().padStart(4)}MB | CPU: ${cpu.toString().padStart(4)}%`);
    });
    
    console.log('─'.repeat(60));
    console.log(`📊 Total Resource Usage: Memory: ${totalMemory}MB | CPU: ${totalCPU.toFixed(1)}%`);
    
    // Resource warnings
    if (totalMemory > 2048) {
      console.log('⚠️  High memory usage detected (>2GB)');
    }
    
    if (totalCPU > 80) {
      console.log('⚠️  High CPU usage detected (>80%)');
    }
    
  } catch (error) {
    console.error('❌ Failed to check process resources:', error.message);
  }
}

async function runProcessMonitor() {
  console.log('🖥️  Production Process Monitor\n');
  
  const processHealthy = await checkPM2Processes();
  await checkProcessResources();
  
  process.exit(processHealthy ? 0 : 1);
}

runProcessMonitor().catch(error => {
  console.error('💥 Process monitor crashed:', error);
  process.exit(1);
});