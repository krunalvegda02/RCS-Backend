import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from '../src/db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

const analyzeDb = async () => {
    try {
        await connectDB();
        console.log('✅ Connected to MongoDB');

        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log(`Found ${collections.length} collections. Counting documents...`);

        const stats = [];

        for (const collection of collections) {
            const count = await mongoose.connection.db.collection(collection.name).countDocuments();
            stats.push({ name: collection.name, count });
        }

        // Sort by count descending
        stats.sort((a, b) => b.count - a.count);

        console.log('\n============== DB USAGE ==============');
        console.table(stats);
        console.log('======================================\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ Analysis failed:', error);
        process.exit(1);
    }
};

analyzeDb();
