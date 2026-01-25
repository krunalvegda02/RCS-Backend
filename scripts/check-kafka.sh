#!/bin/bash

KAFKA_HOME="/opt/kafka"
BOOTSTRAP_SERVER="localhost:9092"

echo "📋 Checking Kafka Topics..."
$KAFKA_HOME/bin/kafka-topics.sh --list --bootstrap-server $BOOTSTRAP_SERVER

echo ""
echo "📊 Topic Details:"
for topic in webhook-events message-stats campaign-batch-entries; do
  echo ""
  echo "Topic: $topic"
  $KAFKA_HOME/bin/kafka-topics.sh --describe --topic $topic --bootstrap-server $BOOTSTRAP_SERVER 2>/dev/null || echo "  ⚠️  Topic not found"
done

echo ""
echo "👥 Consumer Groups:"
$KAFKA_HOME/bin/kafka-consumer-groups.sh --list --bootstrap-server $BOOTSTRAP_SERVER

echo ""
echo "✅ Kafka check complete"
