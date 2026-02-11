import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';

dotenv.config();

async function checkPartitions() {
  try {
    const kafka = new Kafka({
      clientId: 'partition-checker',
      brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
    });

    const admin = kafka.admin();
    await admin.connect();
    console.log('✅ Connected to Kafka');

    const topics = await admin.fetchTopicMetadata({ topics: ['message-stats'] });
    const topic = topics.topics[0];

    console.log(`\n📊 Topic: ${topic.name}`);
    console.log(`📦 Partitions: ${topic.partitions.length}`);
    console.log(`\nPartition details:`);
    topic.partitions.forEach(p => {
      console.log(`  - Partition ${p.partitionId}: Leader ${p.leader}, Replicas: ${p.replicas.length}`);
    });

    await admin.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkPartitions();
