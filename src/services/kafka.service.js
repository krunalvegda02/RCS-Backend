import { Kafka } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'rcs-webhook-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

const producer = kafka.producer({
  allowAutoTopicCreation: true,
  maxInFlightRequests: 10,
  retry: {
    retries: 2,
    initialRetryTime: 100
  }
});

const consumer = kafka.consumer({
  groupId: 'webhook-processors',
  sessionTimeout: 30000,
  heartbeatInterval: 3000
});

let producerConnected = false;
let connectingPromise = null;

export async function connectProducer() {
  if (producerConnected) return;
  if (connectingPromise) return connectingPromise;
  
  connectingPromise = producer.connect().then(() => {
    producerConnected = true;
    connectingPromise = null;
    console.log('✅ Kafka Producer connected');
  });
  
  return connectingPromise;
}

export async function sendWebhookToKafka(webhookData) {
  try {
    await connectProducer();
    
    // Fire-and-forget for maximum throughput
    producer.send({
      topic: 'rcs-webhooks',
      messages: [{
        key: webhookData.messageId || Date.now().toString(),
        value: JSON.stringify(webhookData),
        timestamp: Date.now()
      }]
    }).catch(err => {
      console.error('[Kafka] Send error:', err.message);
      // Don't throw - Kafka will retry internally
    });
    
    return { success: true };
  } catch (error) {
    console.error('[Kafka] Producer error:', error.message);
    return { success: false }; // Don't throw
  }
}

export async function connectConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'rcs-webhooks', fromBeginning: false });
  console.log('✅ Kafka Consumer connected and subscribed');
  return consumer;
}

export async function disconnectKafka() {
  await producer.disconnect();
  await consumer.disconnect();
  console.log('🛑 Kafka disconnected');
}

export { kafka, producer, consumer };
