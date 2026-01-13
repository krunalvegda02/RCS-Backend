import { sendWebhookToKafka } from '../services/kafka.service.js';

const isDev = process.env.NODE_ENV !== 'production';
let webhookCount = 0;

export async function handleWebhookWithKafka(req, res) {
  const messageId = req.body?.entity?.messageId || req.body?.messageId;
  const eventType = req.body?.entity?.eventType || req.body?.eventType;
  
  // 🔥 FIX #1: Only log in dev or every 1000th webhook
  webhookCount++;
  if (isDev || webhookCount % 1000 === 0) {
    console.log(`[Webhook] Received: messageId=${messageId}, eventType=${eventType} (count: ${webhookCount})`);
  }
  
  // Respond immediately
  res.status(200).json({ success: true, message: 'Webhook queued' });
  
  // Send to Kafka async (don't await)
  try {
    sendWebhookToKafka({
      data: req.body,
      timestamp: Date.now(),
      requestId: `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      messageId
    });
    if (isDev || webhookCount % 1000 === 0) {
      console.log(`[Webhook] Sent to Kafka: messageId=${messageId}`);
    }
  } catch (error) {
    console.error(`[Webhook] Kafka send error:`, error.message);
  }
}











