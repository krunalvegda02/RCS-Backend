import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ContactCampaignMessage from '../src/models/contact_campaign_message.model.js';

dotenv.config();

async function removeDuplicateCampaigns() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    console.log('Counting contacts...');
    const totalCount = await ContactCampaignMessage.countDocuments();
    console.log(`Total contacts in database: ${totalCount}`);
    
    console.log('Finding contacts with multiple campaigns...');
    const contacts = await ContactCampaignMessage.find()
      .select('recipientPhoneNumber campaigns campaignIds')
      .lean()
      .limit(100); // Process in batches
    
    console.log(`Found ${contacts.length} contacts to check\n`);
    
    let totalFixed = 0;
    let totalRemoved = 0;
    let processed = 0;
    
    for (const contact of contacts) {
      processed++;
      if (processed % 10 === 0) {
        console.log(`Progress: ${processed}/${contacts.length}`);
      }
      
      if (!contact.campaigns || contact.campaigns.length === 0) {
        continue;
      }
      
      const seen = new Set();
      const uniqueCampaigns = [];
      let hasDuplicates = false;
      
      for (const campaign of contact.campaigns) {
        const campaignId = campaign.campaignId.toString();
        
        if (!seen.has(campaignId)) {
          seen.add(campaignId);
          uniqueCampaigns.push(campaign);
        } else {
          hasDuplicates = true;
        }
      }
      
      if (hasDuplicates) {
        const duplicateCount = contact.campaigns.length - uniqueCampaigns.length;
        console.log(`\nContact ${contact.recipientPhoneNumber}:`);
        console.log(`  Before: ${contact.campaigns.length} campaigns`);
        console.log(`  After: ${uniqueCampaigns.length} campaigns`);
        console.log(`  Removed: ${duplicateCount} duplicates`);
        
        const uniqueCampaignIds = [...seen].map(id => new mongoose.Types.ObjectId(id));
        
        await ContactCampaignMessage.updateOne(
          { _id: contact._id },
          {
            $set: {
              campaigns: uniqueCampaigns,
              campaignIds: uniqueCampaignIds
            }
          }
        );
        
        totalFixed++;
        totalRemoved += duplicateCount;
        console.log(`  ✅ Fixed`);
      }
    }
    
    console.log(`\n========================================`);
    console.log(`Processed: ${processed} contacts`);
    console.log(`Contacts fixed: ${totalFixed}`);
    console.log(`Duplicate campaigns removed: ${totalRemoved}`);
    console.log(`========================================\n`);
    
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

removeDuplicateCampaigns();
