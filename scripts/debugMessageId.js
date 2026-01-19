import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../src/db/index.js';

// The ID from the log that failed lookup
const TARGET_ID = 'cfcc5245-6ec4-45ec-a909-820b365cf04c';

async function run() {
    await connectDB();
    console.log('Connected to DB.');
    console.log(`Searching for ID: ${TARGET_ID}`);

    const ContactCampaignMessage = (await import('../src/models/contact_campaign_message.model.js')).default;

    // 1. Search in campaigns.messageId
    const byMsgId = await ContactCampaignMessage.findOne({ 'campaigns.messageId': TARGET_ID }).lean();
    console.log('Found by campaigns.messageId:', !!byMsgId);
    if (byMsgId) console.log('Doc ID:', byMsgId._id);

    // 2. Search in campaigns.jioMessageId
    const byJioId = await ContactCampaignMessage.findOne({ 'campaigns.jioMessageId': TARGET_ID }).lean();
    console.log('Found by campaigns.jioMessageId:', !!byJioId);
    if (byJioId) console.log('Doc ID:', byJioId._id);

    // 3. Search in campaigns.rcsMessageId
    const byRcsId = await ContactCampaignMessage.findOne({ 'campaigns.rcsMessageId': TARGET_ID }).lean();
    console.log('Found by campaigns.rcsMessageId:', !!byRcsId);
    if (byRcsId) console.log('Doc ID:', byRcsId._id);

    // 4. Broad search (string match anywhere? expensive but useful for debug)
    // Skipping broad search for now, focusing on indexed fields.

    // 5. Check what DOES exist for the recent campaign "test1 big changes"
    console.log('\n--- Checking recent campaign messages ---');
    // Need to find the campaign ID first or just list recent messages
    const recentMessages = await ContactCampaignMessage.find().sort({ createdAt: -1 }).limit(5).lean();

    recentMessages.forEach(msg => {
        console.log(`Msg Doc: ${msg._id}`);
        msg.campaigns.forEach(c => {
            console.log(`  - CampID: ${c.campaignId}`);
            console.log(`  - MsgID: ${c.messageId}`);
            console.log(`  - JioID: ${c.jioMessageId}`);
            console.log(`  - RcsID: ${c.rcsMessageId}`);
            console.log(`  - Status: ${c.status}`);
        });
    });

    process.exit();
}

run();
