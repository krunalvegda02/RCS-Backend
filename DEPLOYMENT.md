# 🚀 Production Deployment Guide

## Prerequisites

### 1. Install Redis (for global rate limiting)
```bash
# macOS
brew install redis
brew services start redis

# Ubuntu
sudo apt install redis-server
sudo systemctl start redis
```

### 2. Install Bottleneck Redis adapter
```bash
npm install ioredis bottleneck
```

### 3. Create Kafka retry topics
```bash
./kafka-topics-setup.sh
```

## Environment Variables
```bash
REDIS_HOST=localhost
REDIS_PORT=6379
KAFKA_BROKER=localhost:9092
```

## PM2 Deployment

### Start all workers
```bash
# Message sender (1 instance only - global rate limiter)
pm2 start src/workers/messageSender.js --name message-sender -i 1

# Retry processor (1 instance only - shares global limiter)
pm2 start src/workers/retryProcessor.js --name retry-processor -i 1

# DB writer (2 instances for redundancy)
pm2 start src/workers/dbWriter.js --name db-writer -i 2

# Webhook consumer
pm2 start src/workers/kafkaConsumer.js --name webhook-consumer -i 2

pm2 save
```

## Rate Limiter Configuration

**Global limits (shared across ALL workers via Redis):**
- Max concurrent: 10 requests
- Min time: 15ms between requests (~66 TPS)
- Reservoir: 4000 requests/minute

**Why this works:**
- Jio RBM safe limit: 30-100 TPS
- Our limit: 66 TPS (well within safe range)
- All workers share same Redis-backed limiter
- No burst overload possible

## Monitoring
```bash
pm2 monit
pm2 logs message-sender --lines 100
```

## Key Improvements

✅ **Problem #1 Fixed:** Global rate limiter via Redis (66 TPS max)
✅ **Problem #2 Fixed:** Kafka ACK only after HTTP send completes
✅ **Problem #3 Fixed:** Delay-specific retry topics with TTL (no infinite growth)
