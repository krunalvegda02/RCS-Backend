
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from '../src/db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

const CAMPAIGN_ID = '696b0d34f4ce94a3d8be8dee';

const cleanupCampaign = async () => {
    try {
        await connectDB();
        console.log('✅ Connected to MongoDB');

        const ContactCampaignMessage = mongoose.model('ContactCampaignMessage');
        const Campaign = mongoose.model('Campaign');

        console.log(`🗑️  Cleaning up campaign ${CAMPAIGN_ID}...`);

        // 1. Remove this campaign from all contact messages
        const updateResult = await ContactCampaignMessage.updateMany(
            { 'campaigns.campaignId': new mongoose.Types.ObjectId(CAMPAIGN_ID) },
            {
                $pull: {
                    campaigns: { campaignId: new mongoose.Types.ObjectId(CAMPAIGN_ID) },
                    campaignIds: new mongoose.Types.ObjectId(CAMPAIGN_ID)
                }
            }
        );
        console.log(`✅ Removed campaign entries from ${updateResult.modifiedCount} contacts`);

        // 2. Delete the campaign document itself
        const deleteResult = await Campaign.deleteOne({ _id: CAMPAIGN_ID });
        console.log(`✅ Deleted campaign document: ${deleteResult.deletedCount}`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Cleanup failed:', error);
        process.exit(1);
    }
};

cleanupCampaign();
