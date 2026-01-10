import { sendWebhookToKafka } from '../services/kafka.service.js';

export async function handleWebhookWithKafka(req, res) {
  // Respond immediately
  res.status(200).json({ success: true, message: 'Webhook queued' });
  
  // Send to Kafka async (don't await)
  sendWebhookToKafka({
    data: req.body,
    timestamp: Date.now(),
    requestId: `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    messageId: req.body?.entity?.messageId || req.body?.messageId
  });
}
