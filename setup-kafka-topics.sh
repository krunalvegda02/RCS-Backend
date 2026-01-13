#!/bin/bash
# Kafka Topic Configuration for 4k+ webhooks/sec
# Run this BEFORE starting your application

KAFKA_BIN="/path/to/kafka/bin"  # Update this path
KAFKA_HOST="localhost:9092"

echo "🔧 Configuring Kafka topics for high throughput (4k+ msg/sec)..."

# 1. Delete existing topics (CAUTION: Only do this in non-production or if acceptable)
echo "⚠️  Deleting existing topics (if any)..."
$KAFKA_BIN/kafka-topics.sh --bootstrap-server $KAFKA_HOST --delete --topic rcs-webhooks 2>/dev/null || true
$KAFKA_BIN/kafka-topics.sh --bootstrap-server $KAFKA_HOST --delete --topic message-log-processing 2>/dev/null || true
$KAFKA_BIN/kafka-topics.sh --bootstrap-server $KAFKA_HOST --delete --topic campaign-batch-entries 2>/dev/null || true
$KAFKA_BIN/kafka-topics.sh --bootstrap-server $KAFKA_HOST --delete --topic rcs-db-updates 2>/dev/null || true

sleep 5

# 2. Create topics with proper partitions
echo "✅ Creating rcs-webhooks (12 partitions, replication: 1)..."
$KAFKA_BIN/kafka-topics.sh --bootstrap-server $KAFKA_HOST \
  --create \
  --topic rcs-webhooks \
  --partitions 12 \
  --replication-factor 1 \
  --config retention.ms=86400000 \
  --config compression.type=gzip \
  --config min.insync.replicas=1

echo "✅ Creating message-log-processing (6 partitions, replication: 1)..."
$KAFKA_BIN/kafka-topics.sh --bootstrap-server $KAFKA_HOST \
  --create \
  --topic message-log-processing \
  --partitions 6 \
  --replication-factor 1 \
  --config retention.ms=86400000 \
  --config compression.type=gzip

echo "✅ Creating campaign-batch-entries (4 partitions, replication: 1)..."
$KAFKA_BIN/kafka-topics.sh --bootstrap-server $KAFKA_HOST \
  --create \
  --topic campaign-batch-entries \
  --partitions 4 \
  --replication-factor 1 \
  --config retention.ms=86400000 \
  --config compression.type=gzip

echo "✅ Creating rcs-db-updates (3 partitions, replication: 1)..."
$KAFKA_BIN/kafka-topics.sh --bootstrap-server $KAFKA_HOST \
  --create \
  --topic rcs-db-updates \
  --partitions 3 \
  --replication-factor 1 \
  --config retention.ms=86400000 \
  --config compression.type=gzip

# 3. Verify topics
echo ""
echo "📊 Verifying topics..."
$KAFKA_BIN/kafka-topics.sh --bootstrap-server $KAFKA_HOST --list
echo ""
$KAFKA_BIN/kafka-topics.sh --bootstrap-server $KAFKA_HOST --describe --topic rcs-webhooks
echo ""
$KAFKA_BIN/kafka-topics.sh --bootstrap-server $KAFKA_HOST --describe --topic message-log-processing

echo ""
echo "✅ Kafka topics configured successfully!"
echo ""
echo "📋 Summary:"
echo "  - rcs-webhooks: 12 partitions (handles 4k+ msg/sec)"
echo "  - message-log-processing: 6 partitions"
echo "  - campaign-batch-entries: 4 partitions"
echo "  - rcs-db-updates: 3 partitions"
echo ""
echo "🚀 You can now start your application with PM2"
