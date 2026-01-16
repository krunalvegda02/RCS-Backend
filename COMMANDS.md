# Quick Commands for Monitoring Wallet Flow

## 🔍 Check Current Status

### Check wallet and blocked balance
```bash
node scripts/findAllBlocked.js
```

### Monitor all campaigns
```bash
node scripts/monitorCampaigns.js
```

### Debug latest campaign
```bash
node scripts/debugLatestCampaign.js
```

---

## 🛠️ Manual Fixes

### Run cleanup manually (with detailed logs)
```bash
npm run cleanup-campaigns
```

### Fix completed campaigns with blocked amounts
```bash
node scripts/fixCompletedCampaigns.js
```

---

## 📊 View Service Logs

### View stats consumer logs (shows campaign completion)
```bash
pm2 logs rcs-stats-consumer --lines 100
```

### View all service logs
```bash
pm2 logs --lines 50
```

### View only errors
```bash
pm2 logs --err --lines 50
```

### View specific service
```bash
pm2 logs rcs-api
pm2 logs rcs-kafka-consumer
pm2 logs rcs-batch-consumer
pm2 logs rcs-stats-consumer
```

---

## 📝 View Cron Job Logs

### View cleanup logs
```bash
tail -f logs/cleanup-campaigns.log
```

### View expire messages logs
```bash
tail -f logs/expire-messages.log
```

### View last 50 lines
```bash
tail -50 logs/cleanup-campaigns.log
```

---

## 🔄 Service Management

### Check service status
```bash
pm2 status
```

### Restart stats consumer (if not completing campaigns)
```bash
pm2 restart rcs-stats-consumer
```

### Restart all services
```bash
pm2 restart all
```

### Stop all services
```bash
pm2 stop all
```

### Start all services
```bash
pm2 start ecosystem.config.cjs
```

---

## 🐛 Debugging Campaign Completion

### See detailed completion logs
The `completeCampaign()` method now logs:
- Campaign ID and current status
- Fresh data from database
- User wallet state
- Message statistics
- Calculation details
- Wallet update results
- Campaign update results
- Verification after commit

### Run cleanup to see these logs
```bash
npm run cleanup-campaigns
```

### Expected output:
```
========================================
[CompleteCampaign] START for campaign 696a39cc...
[CompleteCampaign] Current status: completed, blockedAmount: 1
[CompleteCampaign] Transaction started
[CompleteCampaign] Fetching fresh campaign data...
[CompleteCampaign] Fresh data: status=completed, blockedAmount=1
[CompleteCampaign] User wallet: balance=99995, blocked=1
[CompleteCampaign] Message stats: { total: 1, delivered: 0, failed: 1 }
[CompleteCampaign] Calculations: Blocked=₹1, Actual=₹0, Refund=₹1
[CompleteCampaign] Updating wallet...
[CompleteCampaign] Wallet updated: balance=99995, blocked=0
[CompleteCampaign] Updating campaign document...
[CompleteCampaign] Campaign update result: matched=1, modified=1
[CompleteCampaign] Committing transaction...
[CompleteCampaign] Transaction committed successfully
[CompleteCampaign] Verification: blockedAmount=0, status=completed
✅ Campaign completed successfully
========================================
```

---

## ⚠️ Troubleshooting

### If blocked balance not reducing:

1. **Check if stats consumer is running**
   ```bash
   pm2 status | grep stats-consumer
   ```

2. **Check stats consumer logs**
   ```bash
   pm2 logs rcs-stats-consumer --lines 100
   ```

3. **Run manual cleanup**
   ```bash
   npm run cleanup-campaigns
   ```

4. **Check for errors**
   ```bash
   pm2 logs --err
   ```

### If campaigns stuck in 'running':

1. **Check message statuses**
   ```bash
   node scripts/monitorCampaigns.js
   ```

2. **Wait for cron job** (runs every 10 minutes)
   OR

3. **Run manual cleanup**
   ```bash
   npm run cleanup-campaigns
   ```

---

## 📈 Health Check

Run this to verify everything is working:

```bash
# 1. Check services
pm2 status

# 2. Check wallet
node scripts/findAllBlocked.js

# 3. Check campaigns
node scripts/monitorCampaigns.js

# 4. Check cron jobs
crontab -l
```

All should show:
- ✅ All PM2 services online
- ✅ Blocked balance = 0 (or sum of active campaigns)
- ✅ No stuck campaigns
- ✅ Cron jobs installed
