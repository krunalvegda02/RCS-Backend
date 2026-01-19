import { Kafka } from 'kafkajs';

const kafka = new Kafka({
    clientId: 'admin-diagnostic',
    brokers: ['localhost:9092']
});

const admin = kafka.admin();

async function run() {
    try {
        console.log('Connecting admin...');
        await admin.connect();
        console.log('Connected.');

        const topics = await admin.listTopics();
        console.log('Topics:', topics);

        const metadata = await admin.fetchTopicMetadata({ topics: [] });
        console.log('Cluster Metadata:', JSON.stringify(metadata, null, 2));

        await admin.disconnect();
    } catch (error) {
        console.error('Error:', error);
    }
}

run();
