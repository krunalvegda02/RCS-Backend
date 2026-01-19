import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../src/db/index.js';

const CAMPAIGN_ID = '696dea247baec48d52c40de7';

async function run() {
    await connectDB();
    console.log('Connected to DB.');

    const ContactCampaignMessage = (await import('../src/models/contact_campaign_message.model.js')).default;
    const Campaign = (await import('../src/models/campaign.model.js')).default;

    // 1. Check Campaign Doc
    const camp = await Campaign.findById(CAMPAIGN_ID).lean();
    console.log('Campaign Doc:', JSON.stringify(camp, null, 2));

    // 2. Check Raw ContactCampaignMessage
    console.log('\n--- Raw Contact Messages Check ---');
    const rawMsg = await ContactCampaignMessage.findOne({ 'campaigns.campaignId': new mongoose.Types.ObjectId(CAMPAIGN_ID) });
    if (rawMsg) {
        console.log('Found Raw Msg:', rawMsg._id);
        const cInfo = rawMsg.campaigns.find(c => c.campaignId.toString() === CAMPAIGN_ID);
        console.log('Campaign Entry in Msg:', JSON.stringify(cInfo, null, 2));
    } else {
        console.log('No message found with this campaignId as ObjectId. Trying invalid hex string...');
        // Sometimes if IDs are random strings they won't match ObjectId query
    }

    // 3. Run Aggregation
    console.log('\n--- Running Aggregation ---');
    const campaignIds = [new mongoose.Types.ObjectId(CAMPAIGN_ID)];

    const agg = await ContactCampaignMessage.aggregate([
        { $match: { 'campaigns.campaignId': { $in: campaignIds } } },
        { $unwind: '$campaigns' },
        { $match: { 'campaigns.campaignId': { $in: campaignIds } } },
        {
            $group: {
                _id: '$campaigns.campaignId',
                totalDelivered: { $sum: { $cond: [{ $in: ['$campaigns.status', ['delivered', 'read', 'replied']] }, 1, 0] } },
                totalFailed: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'failed'] }, 1, 0] } },
                totalExpired: { $sum: { $cond: [{ $eq: ['$campaigns.status', 'expired'] }, 1, 0] } }
            }
        }
    ]);

    console.log('Aggregation Result:', JSON.stringify(agg, null, 2));

    process.exit();
}

run();
