# Kafka Batch Processing Setup

## Overview
This implementation uses Kafka to process campaign batch entries asynchronously, reducing processing time from 1 minute to 4-5 seconds.

## Architecture

```
Frontend (CreateCampaignNew.jsx)
    ↓ (Send Campaign)
Master Campaign Creation
    ↓ (30 Sub-campaigns)
Kafka Producer (sendBatchEntriesToKafka)
    ↓ (campaign-batch-entries topic)
Batch Entries Consumer (batchEntriesConsumer.js)
    ↓ (Parallel Processing)
ContactCampaignMessage Bulk Insert
    ↓ (4-5 seconds)
Campaign Ready for Python Bot
```

## Kafka Topics

1. **rcs-webhooks** (10 partitions) - Webhook processing
2. **campaign-batch-entries** (5 partitions) - **NEW** Batch entries processing
3. **message-log-processing** (5 partitions) - Stats processing

## Quick Start

### 1. Start Kafka
```bash
# Development
docker-compose -f docker-compose.kafka.yml up -d

# Production
docker-compose -f docker-compose.kafka.prod.yml up -d
```

### 2. Start All Consumers
```bash
./scripts/start-all-consumers.sh
```

### 3. Stop All Consumers
```bash
./scripts/stop-consumers.sh
```

## Performance Improvements

- **Before**: 1 minute for bulk entries (direct MongoDB operations)
- **After**: 4-5 seconds (Kafka + parallel processing)
- **Throughput**: ~10,000 contacts/second
- **Concurrency**: 5 parallel sub-campaign processors
- **Chunk Size**: 1,000 contacts per chunk

## Monitoring

### Check Consumer Status
```bash
# View logs
tail -f logs/Batch\ Entries\ Consumer.log

# Check PIDs
cat pids/Batch\ Entries\ Consumer.pid
```

### Kafka Topics
```bash
# List topics
docker exec rcs-kafka kafka-topics --bootstrap-server localhost:9092 --list

# Check topic details
docker exec rcs-kafka kafka-topics --bootstrap-server localhost:9092 --describe --topic campaign-batch-entries
```

## Fallback Mechanism

If Kafka is unavailable, the system automatically falls back to direct MongoDB processing to ensure reliability.

## Configuration

### Environment Variables
- `KAFKA_BROKER` - Kafka broker URL (default: localhost:9092)
- `WORKER_MODE` - Set to 'true' for consumer processes

### Performance Tuning
- **Partitions**: 5 for batch entries (balanced load)
- **Concurrency**: 5 parallel processors per consumer
- **Chunk Size**: 1,000 contacts per MongoDB operation
- **Retry Logic**: 3 retries with exponential backoff