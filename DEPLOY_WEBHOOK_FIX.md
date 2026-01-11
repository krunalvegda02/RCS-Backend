# DEPLOY WEBHOOK FIX - ZERO SKIPPED WEBHOOKS

## Changes Made

### 1. ✅ Added jioMessageId field to message model
- Stores Jio's messageId for webhook matching
- Indexed for fast lookups

### 2. ✅ Updated messageSender.js
- Stores both our UUID and Jio's messageId
- Logs both IDs for debugging

### 3. ✅ Updated retryProcessor.js  
- Same jioMessageId storage on retry success

### 4. ✅ Updated kafkaConsumer.js
- Searches by 3 ID fields: messageId, jioMessageId, rcsMessageId
- Phone number fallback for recent messages (last hour)
- Comprehensive diagnostic logging

## Deployment Steps

### Step 1: Push Code to Production
```bash
git add .
git commit -m "Fix webhook skipping - add jioMessageId matching"
git push origin main
```

### Step 2: Pull on Production Server
```bash
cd /root/RCS_MESSAGING/BACKEND
git pull
```

### Step 3: Add MongoDB Index
```bash
mongosh "mongodb+srv://stzkdigitalmedia:Stzk%402024@cluster0.mongodb.net/rcs_messaging"
```

```javascript
// In MongoDB shell
use rcs_messaging

// Add indexes for fast webhook lookup
db.contact_campaign_messages.createIndex({ "campaigns.jioMessageId": 1 })
db.contact_campaign_messages.createIndex({ "campaigns.rcsMessageId": 1 })

// Verify indexes
db.contact_campaign_messages.getIndexes()

exit
```

### Step 4: Restart Workers
```bash
pm2 restart message-sender retry-processor kafka-consumer
pm2 save
```

### Step 5: Monitor Logs
```bash
# Watch for successful webhook processing
pm2 logs kafka-consumer --lines 100 | grep -E "(Found|Inserted|Skipped)"
```

**Expected Output:**
```
[KafkaConsumer] Found 10 matching messages in DB
[KafkaConsumer] ✅ Inserted 10 logs in 50ms | Total processed: 10
```

**NOT:**
```
[KafkaConsumer] ⚠️ Skipped 10 webhooks
```

### Step 6: Verify Fix
```bash
# Check recent sent messages have jioMessageId
mongosh "mongodb+srv://..." --eval "
  db.contact_campaign_messages.findOne(
    {'campaigns.status': 'sent'},
    {'campaigns.\$': 1}
  )
"
```

**Should show:**
```javascript
{
  campaigns: [{
    messageId: "81a46aca-...",      // Our UUID
    jioMessageId: "jio-msg-123",    // ✅ Jio's ID
    rcsMessageId: "jio-msg-123",    // ✅ Same
    status: "sent"
  }]
}
```

### Step 7: Test End-to-End
```bash
# 1. Send test campaign (1-2 messages)
# 2. Wait 10 seconds for Jio webhook
# 3. Check logs

pm2 logs kafka-consumer --lines 50 | tail -20
```

**Success Indicators:**
- ✅ "Found X matching messages in DB" (X > 0)
- ✅ "Inserted X logs" (X > 0)
- ✅ "Total processed: X" (increasing)
- ❌ NO "Skipped webhooks" messages

## Rollback Plan (If Needed)

```bash
git revert HEAD
git push
cd /root/RCS_MESSAGING/BACKEND
git pull
pm2 restart all
```

## Success Metrics

### Before Fix
- Processed: 0
- Skipped: 4000+
- Success Rate: 0%

### After Fix (Target)
- Processed: 4000+
- Skipped: 0
- Success Rate: 100%

## Troubleshooting

### If Still Skipping

**Check 1: Are messages being sent?**
```bash
pm2 logs message-sender | grep "sent successfully"
```

**Check 2: Is jioMessageId being stored?**
```bash
mongosh "..." --eval "
  db.contact_campaign_messages.findOne(
    {'campaigns.sentAt': {\$exists: true}},
    {'campaigns.\$': 1}
  ).campaigns[0]
"
```

**Check 3: What messageIds are webhooks using?**
```bash
pm2 logs kafka-consumer | grep "Parsed webhook"
```

**Check 4: Phone fallback working?**
```bash
pm2 logs kafka-consumer | grep "Phone fallback"
```

### Emergency: Force Match by Phone
If still failing, uncomment phone matching in kafkaConsumer.js (already implemented as fallback)

## Monitoring Commands

```bash
# Real-time webhook processing
watch -n 2 'pm2 logs kafka-consumer --lines 5 --nostream | grep -E "(Found|Inserted|Skipped)"'

# Count processed vs skipped
pm2 logs kafka-consumer --lines 1000 --nostream | grep -c "Inserted"
pm2 logs kafka-consumer --lines 1000 --nostream | grep -c "Skipped"

# Check message statuses
mongosh "..." --eval "
  db.contact_campaign_messages.aggregate([
    {\$unwind: '\$campaigns'},
    {\$group: {_id: '\$campaigns.status', count: {\$sum: 1}}}
  ])
"
```

## Expected Timeline

- **Deploy**: 5 minutes
- **Index creation**: 1 minute
- **Worker restart**: 30 seconds
- **First webhook**: 10-30 seconds after sending message
- **Verification**: 2 minutes

**Total**: ~10 minutes to zero skipped webhooks! 🚀
