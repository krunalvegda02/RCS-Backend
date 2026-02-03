import { Kafka } from 'kafkajs';


// Kafka Client Setup-----
const kafka = new Kafka({
  clientId: 'rcs-webhook-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
  connectionTimeout: 30000,
  requestTimeout: 30000,
  retry: {
    initialRetryTime: 300,
    retries: 5,
    maxRetryTime: 30000,
    multiplier: 2
  }
});







const producer = kafka.producer({
  allowAutoTopicCreation: false,
  maxInFlightRequests: 5,
  idempotent: false,          // to prevent processing on old data 
  transactionalId: undefined
});

const statsProducer = kafka.producer({
  allowAutoTopicCreation: false,
  maxInFlightRequests: 5,
  idempotent: false,
  transactionalId: undefined
});


const dbProducer = kafka.producer({
  allowAutoTopicCreation: false,
  maxInFlightRequests: 10,
  idempotent: false,
  transactionalId: undefined
});


// Consumer for processing webhook events
const consumer = kafka.consumer({
  groupId: `webhook-processor-${process.env.NODE_ENV || 'dev'}`,
  sessionTimeout: 120000, // 2 minutes - increased for slow MongoDB
  heartbeatInterval: 10000, // 10 seconds
  maxBytesPerPartition: 1048576,
  maxWaitTimeInMs: 100,
  rebalanceTimeout: 120000 // 2 minutes for rebalance
});

let producerConnected = false;
let statsProducerConnected = false;
let dbProducerConnected = false;
let connectingPromise = null;
let statsConnectingPromise = null;
let dbConnectingPromise = null;

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
  await connectProducer();

  await producer.send({
    topic: 'webhook-events',
    messages: [{
      key: webhookData.messageId || Date.now().toString(),
      value: JSON.stringify(webhookData),
      timestamp: Date.now()
    }]
  });

  return { success: true };
}

// 🔥 FIX: Batch message buffer for producer
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

    // 🔥 FIX : Use sendBatch for better performance
    if (isBatch && Array.isArray(data)) {
      await statsProducer.sendBatch({
        topicMessages: [{
          topic: 'message-stats',
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
        topic: 'message-stats',
        messages
      }]
    });
  } catch (error) {
    console.error('[Kafka] Batch send error:', error.message);
  }
}


//. Helper funciton to connect  consumer with detailed error handling
export async function connectConsumer() {
  try {
    console.log('[Consumer] Attempting to connect to Kafka...');
   
    await consumer.connect();
    console.log('[Consumer] Connected successfully');

    console.log('[Consumer] Subscribing to webhook-events topic...');
   
    await consumer.subscribe({
      topic: 'webhook-events',
      fromBeginning: false // Start from latest messages
    });
   
    console.log('✅ Kafka Consumer connected and subscribed');
   
   
    return consumer;


  } catch (error) {
    console.error('❌ Consumer connection failed:');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Kafka broker:', process.env.KAFKA_BROKER || 'localhost:9092');

    if (error.message.includes('ECONNREFUSED')) {
      console.error('🔴 Kafka broker is not running on localhost:9092');
      console.error('💡 Start Kafka with: docker-compose -f docker-compose.kafka.prod.yml up -d');
    } else if (error.message.includes('timeout')) {
      console.error('🔴 Connection timeout - Kafka may be starting up');
    } else if (error.message.includes('topic')) {
      console.error('🔴 Topic webhook-events may not exist');
    }

    throw error;
  }
}


export async function sendBatchEntriesToKafka(batchData) {
  try {
    if (!batchData?.campaignId || !Array.isArray(batchData.phoneNumbers)) {
      return { success: false, error: 'Invalid batch data' };
    }

    const campaignId = batchData.campaignId.toString();
    const templateId = batchData.templateId?.toString();
    const userId = batchData.userId.toString();
    const phoneNumbers = batchData.phoneNumbers;

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

    const CHUNK_SIZE = 1000;
    const totalChunks = Math.ceil(phoneNumbers.length / CHUNK_SIZE);

    const messages = [];
    const batchId = `${campaignId}-${Date.now()}`;

    for (let i = 0; i < phoneNumbers.length; i += CHUNK_SIZE) {
      const chunkIndex = Math.floor(i / CHUNK_SIZE);
      const chunk = phoneNumbers.slice(i, i + CHUNK_SIZE);

      messages.push({
        key: campaignId,
        value: JSON.stringify({
          campaignId,
          templateId,
          userId,
          phoneNumbers: chunk,
          chunkIndex,
          totalChunks,
          batchId
        }),
        timestamp: Date.now()
      });
    }

    await dbProducer.sendBatch({
      topicMessages: [{
        topic: 'campaign-batch-entries',
        messages
      }]
    });

    console.log(
      `[Kafka] ✅ Sent ${phoneNumbers.length} contacts in ${totalChunks} chunks`
    );

    return { success: true, chunks: totalChunks };
  } catch (error) {
    console.error('[Kafka] Batch entries send error:', error.message);
    return { success: false, error: error.message };
  }
}


export async function disconnectKafka() {
  await producer.disconnect();
  await statsProducer.disconnect();
  await dbProducer.disconnect();
  await consumer.disconnect();
  console.log('🛑 Kafka disconnected');
}

export { kafka, producer, consumer };