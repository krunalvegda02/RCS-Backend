import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from '../src/db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

const checkDates = async () => {
    try {
        await connectDB();
        console.log('✅ Connected to MongoDB');

        const MessageLog = mongoose.connection.db.collection('message_logs');

        const oldest = await MessageLog.find().sort({ createdAt: 1 }).limit(1).toArray();
        const newest = await MessageLog.find().sort({ createdAt: -1 }).limit(1).toArray();

        if (oldest.length > 0) {
            console.log('Oldest log:', oldest[0].createdAt || oldest[0]._id.getTimestamp());
        } else {
            console.log('No logs found');
        }

        if (newest.length > 0) {
            console.log('Newest log:', newest[0].createdAt || newest[0]._id.getTimestamp());
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Check failed:', error);
        process.exit(1);
    }
};

checkDates();
