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
  allowAutoTopicCreation: false,
  maxInFlightRequests: 5,
  idempotent: true,
  retry: {
    retries: 2,
    initialRetryTime: 100
  } 
});

const statsProducer = kafka.producer({
  allowAutoTopicCreation: false,
  maxInFlightRequests: 5,
  idempotent: true,
  retry: {
    retries: 2,
    initialRetryTime: 100
  }
});

const dbProducer = kafka.producer({
  allowAutoTopicCreation: false,
  maxInFlightRequests: 10,
  idempotent: true,
  retry: {
    retries: 2,
    initialRetryTime: 100
  }
});

const consumer = kafka.consumer({
  groupId: `webhook-processors-${process.env.NODE_ENV || 'dev'}`,
  sessionTimeout: 30000,
  heartbeatInterval: 3000
});

let producerConnected = false;
let statsProducerConnected = false;
let dbProducerConnected = false;
let connectingPromise = null;
let statsConnectingPromise = null;
let dbConnectingPromise = null;

// 🔥 FIX #2: Producer backpressure monitoring
producer.on('producer.network.request_timeout', e => {
  console.error('[Kafka] Producer timeout', e);
});
producer.on('producer.disconnect', () => {
  console.error('[Kafka] Producer disconnected');
});

statsProducer.on('producer.network.request_timeout', e => {
  console.error('[Kafka] Stats Producer timeout', e);
});
statsProducer.on('producer.disconnect', () => {
  console.error('[Kafka] Stats Producer disconnected');
});

dbProducer.on('producer.network.request_timeout', e => {
  console.error('[Kafka] DB Producer timeout', e);
});
dbProducer.on('producer.disconnect', () => {
  console.error('[Kafka] DB Producer disconnected');
});

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
    
    // 🔥 FIX: Await the send to catch errors properly
    await producer.send({
      topic: 'rcs-webhooks',
      messages: [{
        key: webhookData.messageId || Date.now().toString(),
        value: JSON.stringify(webhookData),
        timestamp: Date.now()
      }]
    });
    
    return { success: true };
  } catch (error) {
    console.error('[Kafka] Producer error:', error.message);
    return { success: false };
  }
}

// 🔥 FIX #6: Batch message buffer for producer
let messageBuffer = [];
let bufferTimer = null;
const BUFFER_SIZE = 100;
const BUFFER_TIMEOUT = 50; // 50ms

export async function sendStatsToKafka(data, isBatch = false) {
  try {
    if (!statsProducerConnected) {
      if (!statsConnectingPromise) {
        statsConnectingPromise = statsProducer.connect().then(() => {
          statsProducerConnected = true;
          statsConnectingPromise = null;
          console.log('✅ Kafka Stats Producer connected');
        });
      }
      await statsConnectingPromise;
    }
    
    // 🔥 FIX #6: Use sendBatch for better performance
    if (isBatch && Array.isArray(data)) {
      await statsProducer.sendBatch({
        topicMessages: [{
          topic: 'message-log-processing',
          messages: data
        }]
      });
    } else {
      // Single message - add to buffer
      messageBuffer.push({
        key: data.logId,
        value: JSON.stringify(data)
      });
      
      // Flush if buffer is full
      if (messageBuffer.length >= BUFFER_SIZE) {
        await flushStatsBuffer();
      } else if (!bufferTimer) {
        // Set timer to flush after timeout
        bufferTimer = setTimeout(flushStatsBuffer, BUFFER_TIMEOUT);
      }
    }
  } catch (error) {
    console.error('[Kafka] Stats producer error:', error.message);
  }
}

async function flushStatsBuffer() {
  if (bufferTimer) {
    clearTimeout(bufferTimer);
    bufferTimer = null;
  }
  
  if (messageBuffer.length === 0) return;
  
  const messages = [...messageBuffer];
  messageBuffer = [];
  
  try {
    await statsProducer.sendBatch({
      topicMessages: [{
        topic: 'message-log-processing',
        messages
      }]
    });
  } catch (error) {
    console.error('[Kafka] Batch send error:', error.message);
  }
}

export async function connectConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'rcs-webhooks', fromBeginning: true });
  console.log('✅ Kafka Consumer connected and subscribed');
  return consumer;
}

export async function sendBatchEntriesToKafka(batchData) {
  try {
    if (!batchData || !batchData.campaignId || !batchData.phoneNumbers) {
      console.error('[Kafka] Invalid batchData:', batchData);
      return { success: false, error: 'Invalid batch data structure' };
    }
    
    const sanitizedData = {
      campaignId: batchData.campaignId?.toString ? batchData.campaignId.toString() : batchData.campaignId,
      templateId: batchData.templateId?.toString ? batchData.templateId.toString() : batchData.templateId,
      userId: batchData.userId?.toString ? batchData.userId.toString() : batchData.userId,
      phoneNumbers: batchData.phoneNumbers,
      totalContacts: batchData.phoneNumbers.length
    };
    
    if (!dbProducerConnected) {
      if (!dbConnectingPromise) {
        dbConnectingPromise = dbProducer.connect().then(() => {
          dbProducerConnected = true;
          dbConnectingPromise = null;
          console.log('✅ Kafka DB Producer connected');
        });
      }
      await dbConnectingPromise;
    }
    
    await dbProducer.send({
      topic: 'campaign-batch-entries',
      messages: [{
        key: sanitizedData.campaignId,
        value: JSON.stringify(sanitizedData),
        timestamp: Date.now()
      }]
    });
    
    console.log(`[Kafka] Sent batch entries to Kafka: ${sanitizedData.totalContacts} contacts`);
    return { success: true };
  } catch (error) {
    console.error('[Kafka] Batch entries send error:', error.message);
    return { success: false, error: error.message };
  }
}

export async function sendDBUpdateToKafka(updateData) {
  try {
    if (!dbProducerConnected) {
      if (!dbConnectingPromise) {
        dbConnectingPromise = dbProducer.connect().then(() => {
          dbProducerConnected = true;
          dbConnectingPromise = null;
          console.log('✅ Kafka DB Producer connected');
        });
      }
      await dbConnectingPromise;
    }
    
    dbProducer.send({
      topic: 'rcs-db-updates',
      messages: [{
        key: updateData.messageId,
        value: JSON.stringify(updateData)
      }]
    }).catch(() => {});
  } catch (error) {}
}

export async function disconnectKafka() {
  await producer.disconnect();
  await statsProducer.disconnect();
  await dbProducer.disconnect();
  await consumer.disconnect();
  console.log('🛑 Kafka disconnected');
}



export { kafka, producer, consumer };
