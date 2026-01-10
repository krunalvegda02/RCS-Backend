// ⚠️ DEPRECATED - DO NOT USE
// All webhook processing now handled by kafkaConsumer.js with bulk operations
// Individual DB writes are not scalable for high-throughput systems

export async function processWebhookData(data, timestamp) {
  console.error('[DEPRECATED] processWebhookData should not be called. Use kafkaConsumer.js');
  throw new Error('DEPRECATED: Use kafkaConsumer.js bulk processing');
}

export async function processUserInteraction(data, timestamp) {
  console.error('[DEPRECATED] processUserInteraction should not be called. Use kafkaConsumer.js');
  throw new Error('DEPRECATED: Use kafkaConsumer.js bulk processing');
}
