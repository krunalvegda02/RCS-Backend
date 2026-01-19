import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from '../src/db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

const checkDrafts = async () => {
    try {
        await connectDB();
        console.log('✅ Connected to MongoDB');

        const Campaign = mongoose.model('Campaign');
        const ContactCampaignMessage = mongoose.model('ContactCampaignMessage');

        // Find latest draft campaigns
        const draftCampaigns = await Campaign.find({ status: 'draft' })
            .sort({ createdAt: -1 })
            .limit(5);

        console.log(`Found ${draftCampaigns.length} draft campaigns.`);

        for (const campaign of draftCampaigns) {
            console.log(`\n🔍 Checking Campaign: ${campaign.name} (${campaign._id})`);
            console.log(`   Created At: ${campaign.createdAt}`);
            console.log(`   Expected Total: ${campaign.stats.total}`);

            // Count processed messages
            const messageCount = await ContactCampaignMessage.countDocuments({
                'campaigns.campaignId': campaign._id
            });

            console.log(`   Actual Processed Messages: ${messageCount}`);

            if (messageCount > 0) {
                if (messageCount >= campaign.stats.total) {
                    console.log(`   ⚠️  FULLY PROCESSED but stuck in DRAFT! (Consumer completion logic failed)`);
                } else {
                    console.log(`   ⚠️  Partially processed (${messageCount}/${campaign.stats.total}). (Consumer might be slow or split)`);
                }
            } else {
                console.log(`   ❌ No messages processed. Consumer hasn't touched this yet.`);
            }
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Check failed:', error);
        process.exit(1);
    }
};

checkDrafts();
