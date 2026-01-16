# RCS Messaging System - Complete Setup Guide

## Required Services

For the wallet flow to work correctly, you MUST run these services:

### 1. Main Backend Server
```bash
npm run dev
```
- Handles API requests
- Creates campaigns and blocks wallet balance

### 2. Stats Consumer Worker ⚠️ CRITICAL
```bash
npm run stats-consumer
```
- Processes webhooks from Kafka
- Updates message statuses (sent → delivered/failed)
- **Automatically completes campaigns and adjusts wallets**

### 3. Message Expiration Cron (Optional but Recommended)
```bash
node scripts/expirePendingMessages.js
```
- Expires messages that don't receive webhooks within 5 minutes
- Run as a cron job every 5 minutes

## Wallet Flow

### When Campaign is Created:
1. User creates campaign with N contacts
2. System blocks ₹N from wallet (estimatedCost = N × ₹1)
3. Campaign status: 'pending' → 'running'
4. Messages sent to Kafka queue

### When Webhooks Arrive:
1. **Stats Consumer** processes webhooks
2. Updates message status: pending → sent → delivered/failed
3. Tracks which campaigns have updates
4. After each batch, checks if campaigns are complete

### When Campaign Completes:
1. **Stats Consumer** detects: total > 0 && pending === 0
2. Calls `campaign.completeCampaign()` automatically
3. Wallet adjustment happens:
   - Deduct actual cost (delivered × ₹1)
   - Unblock blocked amount
   - Refund = blocked - actual
4. Campaign status: 'completed'
5. Campaign blockedAmount: 0

## Current Status

✅ Wallet blocking at campaign creation - WORKING
✅ completeCampaign() method - WORKING (wallet FIRST, campaign SECOND)
✅ Stats consumer completion detection - WORKING
⚠️  **Stats Consumer must be running for automatic completion**

## Troubleshooting

### Blocked balance not reducing?
**Check if stats consumer is running:**
```bash
ps aux | grep statsConsumer
```

**If not running, start it:**
```bash
npm run stats-consumer
```

### Manual cleanup for stuck campaigns:
```bash
node scripts/fixCompletedCampaigns.js
```

### Monitor campaigns in real-time:
```bash
node scripts/monitorCampaigns.js
```

## Important Notes

- **Stats Consumer MUST be running** for automatic wallet adjustment
- Without stats consumer, campaigns will stay in 'running' state forever
- Blocked balance will not reduce without stats consumer
- All operations use MongoDB transactions for atomicity
- Only delivered messages are charged (₹1 each)
- Failed and expired messages are refunded automatically
