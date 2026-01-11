# Webhook Logger Service - Debugging Console Guide

## 🔍 Complete Webhook Flow with Console Logs

### Step 1: Webhook Received (API)
```bash
pm2 logs api --lines 50 | grep "\[Webhook\]"
```

**Expected Output:**
```
[Webhook] Received: messageId=abc-123, eventType=MESSAGE_DELIVERED
[Webhook] Sent to Kafka: messageId=abc-123
```

**If Missing:**
- ❌ Webhooks not reaching your server
- Check Jio webhook configuration
- Verify webhook URL is correct

---

### Step 2: Kafka Consumer Processing (kafka-consumer workers)
```bash
pm2 logs kafka-consumer --lines 100 | grep "\[KafkaConsumer\]"
```

**Expected Output:**
```
[KafkaConsumer] Parsed webhook: messageId=abc-123, eventType=MESSAGE_DELIVERED
[KafkaConsumer] Querying 1 messageIds: [ 'abc-123' ]
[KafkaConsumer] Found 1 matching messages in DB
[KafkaConsumer] Built messageMap with 1 entries
[KafkaConsumer] Batch summary: 1 to insert, 0 skipped
[KafkaConsumer] ✅ Inserted 1 logs in 50ms | Total processed: 1
```

**If Missing:**
- ❌ Kafka consumer not running: `pm2 restart kafka-consumer`
- ❌ Kafka broker down: Check Kafka status
- ❌ Consumer not subscribed to topic

**If "0 matching messages in DB":**
- ❌ Message not in database yet (sent too recently)
- ❌ MessageId mismatch between webhook and database
- Check: `db.contact_campaign_messages.findOne({ 'campaigns.messageId': 'abc-123' })`

**If "Skipped webhooks":**
- ⚠️ Webhook messageId not found in database
- This is normal for test webhooks or old messages

---

### Step 3: Log Processor (log-processor worker)
```bash
pm2 logs log-processor --lines 50 | grep "\[LogProcessor\]"
```

**Expected Output:**
```
[LogProcessor] Sending 1 unprocessed logs to Kafka...
[LogProcessor] ✅ Sent 1 logs to Kafka
```

**If Missing:**
- ❌ Log processor not running: `pm2 restart log-processor`
- ❌ No unprocessed logs in database
- Check: `db.message_logs.countDocuments({ processed: false })`

---

### Step 4: Stats Consumer Processing (stats-consumer workers)
```bash
pm2 logs stats-consumer --lines 100 | grep "\[StatsConsumer\]"
```

**Expected Output:**
```
[StatsConsumer] Processing batch of 1 log IDs
[StatsConsumer] Found 1 unprocessed logs in DB
[StatsConsumer] Marked 1 logs as processed
[StatsConsumer] ✅ Updated 1 messages | Total: 1
[StatsConsumer] ✅ Updated 1 wallets
[StatsConsumer] Batch complete: 1 logs in 100ms
```

**If Missing:**
- ❌ Stats consumer not running: `pm2 restart stats-consumer`
- ❌ No messages in Kafka topic
- ❌ Logs already processed

**If "No unprocessed logs":**
- ✅ All logs already processed (normal)
- Or no logs in database yet

**If "No message updates needed":**
- ⚠️ Event type not recognized or no status change needed

---

## 🚨 Common Issues & Solutions

### Issue 1: No Webhooks Received
**Symptoms:**
```bash
pm2 logs api | grep "\[Webhook\]"
# No output
```

**Solutions:**
1. Check Jio webhook configuration
2. Verify webhook URL: `https://your-domain.com/api/v1/webhook`
3. Test webhook endpoint: `curl -X POST https://your-domain.com/api/v1/webhook -d '{"test": true}'`
4. Check firewall/security groups

---

### Issue 2: Kafka Consumer Not Processing
**Symptoms:**
```bash
pm2 logs kafka-consumer | grep "\[KafkaConsumer\]"
# No output or stuck
```

**Solutions:**
1. Restart consumer: `pm2 restart kafka-consumer`
2. Check Kafka broker: `systemctl status kafka` or `docker ps | grep kafka`
3. Check Kafka topics: `kafka-topics.sh --list --bootstrap-server localhost:9092`
4. Check consumer group: `kafka-consumer-groups.sh --bootstrap-server localhost:9092 --group webhook-consumers --describe`

---

### Issue 3: Messages Not Found in Database
**Symptoms:**
```
[KafkaConsumer] Found 0 matching messages in DB
[KafkaConsumer] Batch summary: 0 to insert, 5 skipped
```

**Solutions:**
1. Check if messages exist:
```javascript
db.contact_campaign_messages.findOne({ 
  'campaigns.messageId': 'your-message-id' 
})
```

2. Check if campaign was created:
```javascript
db.campaigns.findOne({ _id: ObjectId('campaign-id') })
```

3. Verify message was sent to Kafka:
```bash
pm2 logs message-sender | grep "messageId"
```

---

### Issue 4: Stats Not Updating
**Symptoms:**
```
[StatsConsumer] No message updates needed
```

**Solutions:**
1. Check event type mapping in statsConsumer.js
2. Verify webhook data structure
3. Check if message status already updated:
```javascript
db.contact_campaign_messages.findOne(
  { 'campaigns.messageId': 'your-message-id' },
  { 'campaigns.$': 1 }
)
```

---

## 📊 Monitoring Commands

### Check All Workers Status
```bash
pm2 status
```

**Expected:**
```
│ api              │ 1      │ online │
│ kafka-consumer   │ 3      │ online │
│ stats-consumer   │ 3      │ online │
│ log-processor    │ 1      │ online │
│ message-sender   │ 10     │ online │
│ retry-processor  │ 5      │ online │
```

---

### Check Webhook Processing Rate
```bash
pm2 logs kafka-consumer --lines 200 | grep "Total processed"
```

**Expected:**
```
[KafkaConsumer] ✅ Inserted 100 logs | Total processed: 100
[KafkaConsumer] ✅ Inserted 150 logs | Total processed: 250
```

---

### Check Stats Processing Rate
```bash
pm2 logs stats-consumer --lines 200 | grep "Total:"
```

**Expected:**
```
[StatsConsumer] ✅ Updated 50 messages | Total: 50
[StatsConsumer] ✅ Updated 100 messages | Total: 150
```

---

### Check Unprocessed Logs Count
```bash
# In MongoDB shell
db.message_logs.countDocuments({ processed: false })
```

**Expected:**
- 0-100: Normal (processing in real-time)
- 100-1000: Slight lag (acceptable)
- 1000+: Backlog (need to scale workers)

---

### Check Message Status Distribution
```bash
# In MongoDB shell
db.contact_campaign_messages.aggregate([
  { $unwind: '$campaigns' },
  { $group: { _id: '$campaigns.status', count: { $sum: 1 } } }
])
```

**Expected:**
```
{ "_id": "sent", "count": 5000 }
{ "_id": "delivered", "count": 4500 }
{ "_id": "read", "count": 2000 }
{ "_id": "failed", "count": 100 }
```

---

## 🔧 Quick Fixes

### Restart All Webhook Workers
```bash
pm2 restart kafka-consumer stats-consumer log-processor
```

### Clear Kafka Consumer Lag
```bash
# Reset consumer group (CAUTION: Will reprocess messages)
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --group webhook-consumers --reset-offsets --to-latest --execute --all-topics
```

### Reprocess Failed Logs
```javascript
// In MongoDB shell
db.message_logs.updateMany(
  { processed: true, 'webhookData.eventType': 'MESSAGE_DELIVERED' },
  { $set: { processed: false } }
)
```

---

## 📈 Performance Metrics

### Expected Processing Times
| Stage | Time | Notes |
|-------|------|-------|
| Webhook → Kafka | < 5ms | Fire-and-forget |
| Kafka → MessageLog | 50-100ms | Batch insert |
| MessageLog → Stats Kafka | 2s | Interval-based |
| Stats Kafka → DB Update | 100-200ms | Batch update |
| **Total** | **2-3s** | End-to-end |

### Expected Throughput
- **Webhooks**: 3000-4000/sec
- **Kafka Consumer**: 2000-3000/sec
- **Stats Consumer**: 1000-2000/sec
- **Bottleneck**: Stats processing (can scale workers)

---

## 🎯 Testing Webhook Flow

### 1. Send Test Message
```bash
# Send a campaign message
curl -X POST https://your-domain.com/api/v1/campaigns/send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"campaignId": "your-campaign-id"}'
```

### 2. Wait for Jio Webhook (5-10 seconds)

### 3. Check Logs in Order
```bash
# Step 1: Webhook received
pm2 logs api --lines 20 | grep "\[Webhook\]"

# Step 2: Kafka consumer processed
pm2 logs kafka-consumer --lines 50 | grep "Inserted"

# Step 3: Log processor sent to stats
pm2 logs log-processor --lines 20 | grep "Sent"

# Step 4: Stats consumer updated message
pm2 logs stats-consumer --lines 50 | grep "Updated"
```

### 4. Verify in Database
```javascript
// Check message status
db.contact_campaign_messages.findOne(
  { 'campaigns.messageId': 'your-message-id' },
  { 'campaigns.$': 1 }
)

// Should show:
// status: 'delivered'
// deliveredAt: ISODate(...)
```

---

## ✅ System Health Checklist

- [ ] All PM2 workers online
- [ ] Kafka broker running
- [ ] MongoDB connected
- [ ] Webhooks being received (check API logs)
- [ ] Kafka consumer processing (check kafka-consumer logs)
- [ ] Stats consumer updating (check stats-consumer logs)
- [ ] Unprocessed logs < 100
- [ ] Message statuses updating in DB

**If all checked: System is healthy! 🚀**
