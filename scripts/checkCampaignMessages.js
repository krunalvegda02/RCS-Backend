import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from '../src/db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

const CAMPAIGN_ID = '696b0d34f4ce94a3d8be8dee';

const checkCampaign = async () => {
    try {
        await connectDB();
        console.log('✅ Connected to MongoDB');

        const ContactCampaignMessage = mongoose.connection.db.collection('contact_campaign_messages');

        // Check raw count by campaignId in the campaigns array
        // Note: Structure is usually campaigns: [{ campaignId: ObjectId, ... }]
        // But direct query might need exact path match
        console.log(`Checking messages for campaign ${CAMPAIGN_ID}...`);

        // We need to query inside the 'campaigns' array
        const count = await ContactCampaignMessage.countDocuments({
            'campaigns.campaignId': new mongoose.Types.ObjectId(CAMPAIGN_ID)
        });

        console.log(`Count from MongoDB: ${count}`);

        if (count > 0) {
            console.log('Sample message:');
            const sample = await ContactCampaignMessage.findOne({
                'campaigns.campaignId': new mongoose.Types.ObjectId(CAMPAIGN_ID)
            });
            console.log(JSON.stringify(sample, null, 2));
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Check failed:', error);
        process.exit(1);
    }
};

checkCampaign();
