# 🎯 ROOT CAUSE FOUND - MessageIds Don't Exist in Database

## The Problem

**Webhooks are being received, but messageIds don't exist in ContactCampaignMessage table!**

### Evidence from Logs:
```
[KafkaConsumer] Found 0 documents in DB for 1 messageIds
[KafkaConsumer] ⚠️ 1 messageIds NOT found in DB. Examples: 7f2c9035-94d6-4ee4-98dd-9c6883214387
[KafkaConsumer] No logs to insert (all 1 messages skipped)
```

### What This Means:
1. ✅ Webhooks ARE being received by app.js
2. ✅ Kafka IS working and sending messages
3. ✅ Consumers ARE running and processing
4. ❌ **MessageIds from webhooks DON'T EXIST in the database**
5. ❌ Messages are skipped because there's no userId/campaignId to associate them with

---

## The Fix Applied

### Changed kafkaConsumer.js to log ALL webhooks (even orphaned ones):

**Before:**
```javascript
if (msgInfo?.userId) {
  logsToInsert.push({...}); // Only log if userId found
} else {
  skippedCount++; // Skip and lose the data
}
```

**After:**
```javascript
if (msgInfo?.userId) {
  logsToInsert.push({...}); // Log with proper userId
} else {
  // 🔥 FIX: Log orphaned webhooks with placeholder userId
  logsToInsert.push({
    messageId: parsed.messageId,
    campaignId: null,
    userId: new mongoose.Types.ObjectId('000000000000000000000000'),
    eventType: 'webhook_received',
    webhookData: {...},
    metadata: { source: 'webhook', orphaned: true }
  });
  skippedCount++;
}
```

---

## What Happens Now

### After deploying this fix:
1. ✅ ALL webhooks will be logged to MessageLog table
2. ✅ Orphaned webhooks (no matching messageId) will have:
   - `userId: 000000000000000000000000` (placeholder)
   - `campaignId: null`
   - `eventType: 'webhook_received'`
   - `metadata.orphaned: true`
3. ✅ You can query orphaned webhooks to debug the issue
4. ✅ No webhook data is lost

---

## Next Steps - Find Why MessageIds Are Missing

### 1. Check if campaigns are being created:
```javascript
db.contact_campaign_messages.countDocuments()
db.contact_campaign_messages.findOne()
```

### 2. Check what messageIds exist:
```javascript
db.contact_campaign_messages.aggregate([
  { $unwind: '$campaigns' },
  { $limit: 10 },
  { $project: { 
      messageId: '$campaigns.messageId',
      jioMessageId: '$campaigns.jioMessageId',
      rcsMessageId: '$campaigns.rcsMessageId'
  }}
])
```

### 3. Compare webhook messageIds vs database messageIds:
```javascript
// Orphaned webhooks
db.message_logs.find({ 'metadata.orphaned': true }).limit(5)

// Check if those messageIds exist anywhere
db.contact_campaign_messages.findOne({
  $or: [
    { 'campaigns.messageId': '7f2c9035-94d6-4ee4-98dd-9c6883214387' },
    { 'campaigns.jioMessageId': '7f2c9035-94d6-4ee4-98dd-9c6883214387' },
    { 'campaigns.rcsMessageId': '7f2c9035-94d6-4ee4-98dd-9c6883214387' }
  ]
})
```

### 4. Check campaign creation flow:
- Look at the code that sends RCS messages
- Verify it's storing messageId/jioMessageId/rcsMessageId in ContactCampaignMessage
- Check if there's a timing issue (webhook arrives before DB insert)

---

## Possible Root Causes

### 1. Campaign Not Created Yet
- Webhooks arrive before campaign is saved to DB
- **Solution:** Add delay or use message queue for campaign creation

### 2. Wrong MessageId Field
- Webhook uses `messageId` but DB stores `jioMessageId` or `rcsMessageId`
- **Solution:** Check which field is being populated during message send

### 3. MessageId Mismatch
- The messageId in webhook doesn't match what was stored
- **Solution:** Log messageIds during campaign creation and compare

### 4. Old Webhooks
- These are webhooks for old campaigns that were deleted
- **Solution:** Check webhook timestamps vs campaign creation dates

---

## Deploy Instructions

```bash
# 1. Upload the fixed kafkaConsumer.js to server
scp src/workers/kafkaConsumer.js root@srv1185206:/var/www/rcs-backend/src/workers/

# 2. Restart kafka consumers
pm2 restart kafka-consumer-1

# 3. Monitor logs
pm2 logs kafka-consumer-1 --lines 50

# 4. Check MessageLog table
# You should now see entries with orphaned: true
```

---

## Expected Log Output After Fix

```
[KafkaConsumer] Processing batch: 1 messages from partition 8
[KafkaConsumer] Found 1 valid messageIds to process
[KafkaConsumer] Querying DB for 1 uncached messageIds...
[KafkaConsumer] Found 0 documents in DB for 1 messageIds
[KafkaConsumer] ⚠️ 1 messageIds NOT found in DB. Examples: abc-123
[KafkaConsumer] Building logs from 1 parsed messages...
[KafkaConsumer] ✅ 1 logs in 45ms (22/sec) | Orphaned: 1 | Total: 1
```

And in MessageLog table:
```javascript
{
  _id: ObjectId("..."),
  messageId: "abc-123",
  userId: ObjectId("000000000000000000000000"),
  campaignId: null,
  eventType: "webhook_received",
  status: "success",
  webhookData: { eventType: "MESSAGE_READ", ... },
  metadata: { source: "webhook", orphaned: true },
  timestamp: ISODate("2026-01-13T...")
}
```

---

**Status:** Fix applied. Now ALL webhooks will be logged, even orphaned ones. Next step is to investigate why messageIds don't exist in the database.
