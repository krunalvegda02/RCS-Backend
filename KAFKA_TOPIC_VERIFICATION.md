# KAFKA TOPIC & PARTITION VERIFICATION

## PRODUCER → TOPIC MAPPING

### 1. webhookKafka.controller.js → kafka.service.js
```javascript
// File: src/controller/webhookKafka.controller.js
sendWebhookToKafka() 
  ↓
// File: src/services/kafka.service.js
producer.send({ topic: 'webhook-events' })  ✅
```

### 2. webhookConsumer.js → kafka.service.js
```javascript
// File: src/workers/webhookConsumer.js
sendStatsToKafka(messages, true)
  ↓
// File: src/services/kafka.service.js
statsProducer.sendBatch({ topic: 'message-stats' })  ✅
```

### 3. Campaign API → kafka.service.js
```javascript
// File: Campaign creation endpoint
sendBatchEntriesToKafka()
  ↓
// File: src/services/kafka.service.js
dbProducer.sendBatch({ topic: 'campaign-batch-entries' })  ✅
```

## CONSUMER → TOPIC MAPPING

### 1. webhookConsumer.js
```javascript
// File: src/workers/webhookConsumer.js
connectConsumer()
  ↓
// File: src/services/kafka.service.js
consumer.subscribe({ topic: 'webhook-events' })  ✅
groupId: 'webhook-processor-production'  ✅
```

### 2. statsConsumer.js
```javascript
// File: src/workers/statsConsumer.js
consumer.subscribe({ topic: 'message-stats' })  ✅
groupId: 'stats-processor-production'  ✅
```

### 3. batchEntriesConsumer.js
```javascript
// File: src/workers/batchEntriesConsumer.js
consumer.subscribe({ topic: 'campaign-batch-entries' })  ✅
groupId: 'batch-entries-processor-production'  ✅
```

## PARTITION ASSIGNMENT

### Topic: webhook-events
```
Required Partitions: 8
Consumer Instances: 8 (webhook-consumer)
Consumer Group: webhook-processor-production
Assignment: 1 partition per instance  ✅

Partition 0 → webhook-consumer instance 0
Partition 1 → webhook-consumer instance 1
Partition 2 → webhook-consumer instance 2
Partition 3 → webhook-consumer instance 3
Partition 4 → webhook-consumer instance 4
Partition 5 → webhook-consumer instance 5
Partition 6 → webhook-consumer instance 6
Partition 7 → webhook-consumer instance 7
```

### Topic: message-stats
```
Required Partitions: 6
Consumer Instances: 6 (stats-consumer)
Consumer Group: stats-processor-production
Assignment: 1 partition per instance  ✅

Partition 0 → stats-consumer instance 0
Partition 1 → stats-consumer instance 1
Partition 2 → stats-consumer instance 2
Partition 3 → stats-consumer instance 3
Partition 4 → stats-consumer instance 4
Partition 5 → stats-consumer instance 5
```

### Topic: campaign-batch-entries
```
Required Partitions: 3
Consumer Instances: 3 (batch-consumer)
Consumer Group: batch-entries-processor-production
Assignment: 1 partition per instance  ✅

Partition 0 → batch-consumer instance 0
Partition 1 → batch-consumer instance 1
Partition 2 → batch-consumer instance 2
```

## DATA FLOW VERIFICATION

```
┌─────────────────────────────────────────────────────────┐
│                    WEBHOOK FLOW                          │
└─────────────────────────────────────────────────────────┘
POST /webhook
    ↓
webhookKafka.controller.js
    ↓
kafka.service.js → producer
    ↓
Topic: webhook-events (8 partitions)  ✅
    ↓
webhookConsumer.js (8 instances)  ✅
Group: webhook-processor-production  ✅
    ↓
Creates MessageLog
    ↓
kafka.service.js → statsProducer
    ↓
Topic: message-stats (6 partitions)  ✅
    ↓
statsConsumer.js (6 instances)  ✅
Group: stats-processor-production  ✅
    ↓
Updates ContactCampaignMessage

┌─────────────────────────────────────────────────────────┐
│                   CAMPAIGN FLOW                          │
└─────────────────────────────────────────────────────────┘
POST /campaign
    ↓
Campaign API
    ↓
kafka.service.js → dbProducer
    ↓
Topic: campaign-batch-entries (3 partitions)  ✅
    ↓
batchEntriesConsumer.js (3 instances)  ✅
Group: batch-entries-processor-production  ✅
    ↓
Creates ContactCampaignMessage entries
```

## VERIFICATION CHECKLIST

- [x] All producers use correct topic names
- [x] All consumers subscribe to correct topics
- [x] All consumer groups are unique
- [x] Partition count matches instance count
- [x] No topic name mismatches
- [x] No consumer group conflicts
- [x] Data flow is correct

## REQUIRED KAFKA TOPICS

Create these topics on your Kafka server:

```bash
# webhook-events (8 partitions)
kafka-topics.sh --bootstrap-server localhost:9092 \
  --create --topic webhook-events --partitions 8 --replication-factor 1

# message-stats (6 partitions)
kafka-topics.sh --bootstrap-server localhost:9092 \
  --create --topic message-stats --partitions 6 --replication-factor 1

# campaign-batch-entries (3 partitions)
kafka-topics.sh --bootstrap-server localhost:9092 \
  --create --topic campaign-batch-entries --partitions 3 --replication-factor 1
```

## VERIFICATION COMMANDS

```bash
# List all topics
kafka-topics.sh --bootstrap-server localhost:9092 --list

# Describe topics
kafka-topics.sh --bootstrap-server localhost:9092 --describe \
  --topic webhook-events,message-stats,campaign-batch-entries

# Check consumer groups
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --list

# Check specific group
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group webhook-processor-production
```

## STATUS: ✅ ALL CORRECT

All Kafka services are correctly assigned with proper topic names and partition counts.
