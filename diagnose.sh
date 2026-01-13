#!/bin/bash

echo "=== Checking Kafka Consumer Logs ==="
pm2 logs kafka-consumer-1 --lines 50 --nostream

echo ""
echo "=== Checking if consumers are processing ==="
pm2 logs kafka-consumer-1 --lines 200 --nostream | grep -E "Processing batch|Found.*messageIds|NOT found in DB|logs in.*ms"

echo ""
echo "=== Checking Kafka topics ==="
kafka-topics.sh --bootstrap-server localhost:9092 --list

echo ""
echo "=== Checking consumer group lag ==="
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group webhook-processors-production

echo ""
echo "=== Sample webhook data in Kafka ==="
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic rcs-webhooks --max-messages 1 --timeout-ms 5000

echo ""
echo "=== Check ContactCampaignMessage for sample messageIds ==="
mongosh "$MONGODB_URI" --eval "
  db.contact_campaign_messages.aggregate([
    { \$unwind: '\$campaigns' },
    { \$limit: 3 },
    { \$project: { 
        messageId: '\$campaigns.messageId',
        jioMessageId: '\$campaigns.jioMessageId',
        rcsMessageId: '\$campaigns.rcsMessageId',
        userId: 1
    }}
  ]).forEach(printjson)
"
