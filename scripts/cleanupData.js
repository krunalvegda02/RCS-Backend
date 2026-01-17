import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from '../src/db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

const cleanup = async () => {
    try {
        const conn = await connectDB();
        console.log('✅ Connected to MongoDB');

        const MessageLog = mongoose.connection.db.collection('message_logs');
        const ContactCampaignMessage = mongoose.connection.db.collection('contact_campaign_messages');

        console.log('🗑️  Deleting message_logs...');
        const logsResult = await MessageLog.deleteMany({});
        console.log(`✅ Deleted ${logsResult.deletedCount} message logs`);

        console.log('🗑️  Deleting contact_campaign_messages...');
        const msgsResult = await ContactCampaignMessage.deleteMany({});
        console.log(`✅ Deleted ${msgsResult.deletedCount} contact campaign messages`);

        console.log('\n🎉 Cleanup complete. Space should be reclaimed.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Cleanup failed:', error);
        process.exit(1);
    }
};

cleanup();
