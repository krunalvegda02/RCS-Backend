# 🚀 DEPLOYMENT CHECKLIST - 4K+ WEBHOOKS/SEC

## ✅ CRITICAL: Kafka Partitions MUST Be Configured First

### Current Status
Your code is now fixed and ready for 4k+ msg/sec, BUT Kafka topics need proper partitions.

### Why Partitions Matter
- **Kafka parallelism = number of partitions, NOT consumers**
- If topic has 2 partitions but 10 consumers → only 2 work, 8 idle
- At 4k+ msg/sec with wrong partitions = bottleneck + lag

---

## 📊 REQUIRED PARTITION CONFIGURATION

| Topic | Partitions | Consumers | Throughput |
|-------|-----------|-----------|------------|
| `rcs-webhooks` | **12** | 3 | 4k+ msg/sec |
| `message-log-processing` | **6** | 3 | ~4k msg/sec |
| `campaign-batch-entries` | **4** | 2 | Low frequency |
| `rcs-db-updates` | **3** | 1 | Low frequency |

---

## 🔧 STEP-BY-STEP DEPLOYMENT

### Step 1: Configure Kafka Topics

**Option A: Using Docker Compose (Recommended)**
```bash
cd /Users/stzkdigitalmedia/Desktop/RCS_MESSAGING/BACKEND

# Stop existing Kafka
docker-compose -f docker-compose.kafka.prod.yml down -v

# Start with new configuration (includes kafka-setup service)
docker-compose -f docker-compose.kafka.prod.yml up -d

# Verify topics
docker exec rcs-kafka kafka-topics --bootstrap-server localhost:9092 --list
docker exec rcs-kafka kafka-topics --bootstrap-server localhost:9092 --describe --topic rcs-webhooks
```

**Option B: Using Shell Script**
```bash
chmod +x setup-kafka-topics.sh
# Edit KAFKA_BIN path in script first
./setup-kafka-topics.sh
```

### Step 2: Drop Old MongoDB Indexes
```bash
mongosh "mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/test"

# Drop old indexes
db.message_logs.dropIndex("messageId_1_eventType_1")
db.contact_campaign_messages.dropIndex("recipientPhoneNumber_1")

# Verify
db.message_logs.getIndexes()
db.contact_campaign_messages.getIndexes()
```

### Step 3: Deploy Application
```bash
cd /Users/stzkdigitalmedia/Desktop/RCS_MESSAGING/BACKEND

# Stop all PM2 processes
pm2 stop all
pm2 delete all

# Start with new configuration
pm2 start ecosystem.config.cjs

# Verify all processes running
pm2 status
pm2 logs --lines 50
```

### Step 4: Verify Kafka Consumer Groups
```bash
# Check consumer groups are balanced
docker exec rcs-kafka kafka-consumer-groups --bootstrap-server localhost:9092 --describe --group webhook-processors-production

# Should show:
# - 3 consumers
# - Each assigned 4 partitions (12 partitions / 3 consumers)
# - LAG should be 0 or low
```

---

## 🎯 PERFORMANCE EXPECTATIONS

### With Correct Configuration:
- ✅ **4k+ webhooks/sec** → Processed smoothly
- ✅ **Consumer lag** → Near zero (<100 messages)
- ✅ **DB writes** → Batched efficiently
- ✅ **No data loss** → Safe ACK pattern
- ✅ **No duplicates** → Idempotent producers

### Throughput Per Consumer:
- Each webhook consumer: ~1,333 msg/sec (4k / 3)
- Each stats consumer: ~1,333 msg/sec (4k / 3)
- Well within capacity (1 partition ≈ 800-1000 msg/sec)

---

## 📈 MONITORING COMMANDS

### Check Consumer Lag:
```bash
docker exec rcs-kafka kafka-consumer-groups --bootstrap-server localhost:9092 --describe --all-groups
```

### Check Topic Throughput:
```bash
docker exec rcs-kafka kafka-run-class kafka.tools.GetOffsetShell --broker-list localhost:9092 --topic rcs-webhooks --time -1
```

### PM2 Monitoring:
```bash
pm2 monit
pm2 logs kafka-consumer-1 --lines 100
pm2 logs stats-consumer --lines 100
```

---

## ⚠️ CRITICAL WARNINGS

1. **DO NOT start application before configuring Kafka partitions**
   - Wrong partitions = bottleneck at scale
   
2. **DO NOT use auto topic creation in production**
   - Already disabled in kafka.service.js
   - Topics must be pre-created with correct partitions

3. **DO NOT skip MongoDB index migration**
   - Old indexes will cause conflicts
   - New composite indexes are required

---

## 🐛 TROUBLESHOOTING

### Issue: High Consumer Lag
```bash
# Check partition count
docker exec rcs-kafka kafka-topics --bootstrap-server localhost:9092 --describe --topic rcs-webhooks

# If partitions < 12, recreate topic
docker exec rcs-kafka kafka-topics --bootstrap-server localhost:9092 --delete --topic rcs-webhooks
# Then run setup script again
```

### Issue: Consumers Not Balanced
```bash
# Restart consumer group
pm2 restart kafka-consumer-1 kafka-consumer-2 kafka-consumer-3
```

### Issue: Duplicate Messages
```bash
# Check idempotent producer setting
# Should see in logs: "idempotent=true"
pm2 logs api --lines 50 | grep idempotent
```

---

## ✅ SUCCESS CRITERIA

After deployment, verify:
- [ ] All 12 partitions created for rcs-webhooks
- [ ] 3 webhook consumers each handling 4 partitions
- [ ] Consumer lag < 100 messages at 4k msg/sec
- [ ] No errors in PM2 logs
- [ ] MongoDB indexes recreated
- [ ] Test campaign creation works
- [ ] Webhook processing works

---

## 📞 SUPPORT

If issues persist:
1. Check PM2 logs: `pm2 logs --lines 200`
2. Check Kafka consumer groups: `docker exec rcs-kafka kafka-consumer-groups --bootstrap-server localhost:9092 --describe --all-groups`
3. Check MongoDB slow queries: `db.currentOp({"secs_running": {$gte: 1}})`
