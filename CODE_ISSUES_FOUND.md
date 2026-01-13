# 🐛 CODE ISSUES FOUND - Message Logging Not Working

## Root Cause Analysis

### Issue: Webhooks received but MessageLog table empty

---

## BUG #1: Fire-and-Forget Kafka Send (CRITICAL) ❌

**File:** `src/services/kafka.service.js`  
**Line:** 93-100  
**Severity:** CRITICAL

### Problem:
```javascript
// WRONG - Fire-and-forget pattern
producer.send({...}).catch(err => {
  console.error('[Kafka] Send error:', err.message);
});
return { success: true }; // Always returns success!
```

**Impact:**
- If Kafka send fails, error is logged but function still returns `{ success: true }`
- Messages are silently lost
- No way to track failed sends

### Fix:
```javascript
// CORRECT - Await the send
await producer.send({...});
return { success: true };
```

---

## BUG #2: Webhook Handler Not Async ❌

**File:** `src/app.js`  
**Line:** 77  
**Severity:** HIGH

### Problem:
```javascript
// WRONG - Not async, can't await Kafka send
app.post('/api/v1/jio/rcs/webhooks', (req, res) => {
  sendWebhookToKafka({...}); // Fire-and-forget
});
```

**Impact:**
- Can't properly handle Kafka send errors
- No visibility into failed sends
- Messages may be lost without notification

### Fix:
```javascript
// CORRECT - Async handler with error tracking
app.post('/api/v1/jio/rcs/webhooks', async (req, res) => {
  res.status(200).json({ success: true }); // Respond first
  
  const result = await sendWebhookToKafka({...});
  if (!result.success) {
    console.error(`[Webhook] ❌ Failed to send to Kafka: ${messageId}`);
  }
});
```

---

## BUG #3: Missing Debug Logging in Consumer ❌

**File:** `src/workers/kafkaConsumer.js`  
**Lines:** 93-120  
**Severity:** MEDIUM

### Problem:
- No logging for DB query results
- Can't see how many messageIds are found vs not found
- No visibility into why messages are skipped

### Fix Added:
```javascript
console.log(`[KafkaConsumer] Querying DB for ${uncachedIds.length} uncached messageIds...`);
console.log(`[KafkaConsumer] Found ${messageDocs.length} documents in DB`);
console.log(`[KafkaConsumer] Matched ${matchedCount} messageIds from DB query`);
console.log(`[KafkaConsumer] ⚠️ ${unmatchedIds.length} messageIds NOT found in DB`);
```

---

## Why Messages Weren't Being Logged

### Flow Analysis:

1. ✅ **Webhook received** → app.js logs it
2. ❌ **Kafka send fails silently** → No error thrown, returns success
3. ❌ **Consumer never receives message** → Nothing to process
4. ❌ **MessageLog table stays empty** → No logs inserted

### The Real Problem:

**MessageIds in webhooks don't exist in ContactCampaignMessage table!**

The consumer looks for:
- `campaigns.messageId`
- `campaigns.jioMessageId`
- `campaigns.rcsMessageId`

If the webhook's messageId doesn't match ANY of these in the database, the message is **skipped** and not logged.

---

## Diagnostic Steps for Server

### 1. Check if Kafka is receiving messages:
```bash
# List topics
kafka-topics.sh --bootstrap-server localhost:9092 --list

# Check message count in rcs-webhooks topic
kafka-run-class.sh kafka.tools.GetOffsetShell \
  --broker-list localhost:9092 \
  --topic rcs-webhooks

# Consume messages to see what's in Kafka
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic rcs-webhooks \
  --from-beginning \
  --max-messages 5
```

### 2. Check consumer lag:
```bash
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --group webhook-processors-production
```

### 3. Check consumer logs:
```bash
pm2 logs kafka-consumer-1 --lines 100
```

Look for:
- `[KafkaConsumer] ⚠️ X messageIds NOT found in DB`
- `[KafkaConsumer] No logs to insert (all X messages skipped)`

### 4. Verify messageIds in database:
```javascript
// In MongoDB shell or Compass
db.contact_campaign_messages.findOne(
  { 'campaigns.messageId': 'YOUR_MESSAGE_ID_FROM_WEBHOOK' }
)

// Check what messageIds exist
db.contact_campaign_messages.aggregate([
  { $unwind: '$campaigns' },
  { $limit: 5 },
  { $project: { 
      messageId: '$campaigns.messageId',
      jioMessageId: '$campaigns.jioMessageId',
      rcsMessageId: '$campaigns.rcsMessageId'
  }}
])
```

---

## Expected Behavior After Fixes

### Webhook Flow:
1. ✅ Webhook received → Logged
2. ✅ Kafka send attempted → Awaited
3. ✅ If send fails → Error logged with messageId
4. ✅ Consumer receives message → Processes it
5. ✅ Consumer queries DB → Logs results
6. ✅ If messageId found → Inserts into MessageLog
7. ✅ If messageId NOT found → Logs warning with examples

### Logs You Should See:
```
[Webhook] Received: abc-123, eventType = MESSAGE_DELIVERED
[KafkaConsumer] Processing batch: 10 messages from partition 0
[KafkaConsumer] Found 10 valid messageIds to process
[KafkaConsumer] Querying DB for 10 uncached messageIds...
[KafkaConsumer] Found 8 documents in DB for 10 messageIds
[KafkaConsumer] Matched 8 messageIds from DB query
[KafkaConsumer] ⚠️ 2 messageIds NOT found in DB. Examples: xyz-789, def-456
[KafkaConsumer] ✅ 8 logs in 45ms (177/sec) | Skipped: 2 | Total: 1058
```

---

## Files Modified

1. ✅ `src/services/kafka.service.js` - Fixed fire-and-forget pattern
2. ✅ `src/app.js` - Made webhook handler async with error tracking
3. ✅ `src/workers/kafkaConsumer.js` - Added comprehensive debug logging

---

## Next Steps

1. Deploy fixes to server
2. Restart all services: `pm2 restart all`
3. Send test webhook
4. Check logs for the new debug output
5. Verify if messageIds exist in ContactCampaignMessage table
6. If messageIds don't exist, investigate campaign creation flow

---

**Status:** Code fixes complete. Need to verify on server with actual data.
