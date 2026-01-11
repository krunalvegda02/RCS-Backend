#!/bin/bash

echo "=== SYSTEM DIAGNOSTIC ==="
echo ""

echo "1. PM2 Status:"
pm2 status | grep -E "(api|message-sender|kafka-consumer)"
echo ""

echo "2. Queued Messages in DB:"
mongosh "mongodb+srv://stzkdigitalmedia:Stzk%402024@cluster0.mongodb.net/rcs_messaging" --quiet --eval "db.contact_campaign_messages.countDocuments({'campaigns.status': 'queued'})"
echo ""

echo "3. Draft Messages in DB:"
mongosh "mongodb+srv://stzkdigitalmedia:Stzk%402024@cluster0.mongodb.net/rcs_messaging" --quiet --eval "db.contact_campaign_messages.countDocuments({'campaigns.status': 'draft'})"
echo ""

echo "4. Recent Message Sender Logs:"
pm2 logs message-sender --lines 20 --nostream | tail -10
echo ""

echo "5. Recent Kafka Consumer Logs:"
pm2 logs kafka-consumer --lines 20 --nostream | tail -10
echo ""

echo "6. Kafka Topics:"
kafka-topics.sh --list --bootstrap-server localhost:9092 2>/dev/null || echo "Kafka not accessible"
echo ""

echo "=== END DIAGNOSTIC ==="
