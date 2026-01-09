import mongoose from 'mongoose';

const MONGO_URI = 'mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/test?retryWrites=true&w=majority';

const ContactCampaignMessageSchema = new mongoose.Schema({
  recipientPhoneNumber: String,
  userId: mongoose.Schema.Types.ObjectId,
  campaignIds: [mongoose.Schema.Types.ObjectId],
  campaigns: [{
    campaignId: mongoose.Schema.Types.ObjectId,
    templateId: mongoose.Schema.Types.ObjectId,
    messageId: String,
    status: String,
    queuedAt: Date,
    sentAt: Date,
    deliveredAt: Date
  }]
}, { collection: 'contact_campaign_messages' });

const ContactCampaignMessage = mongoose.model('ContactCampaignMessage', ContactCampaignMessageSchema);

const CampaignSchema = new mongoose.Schema({
  name: String,
  userId: mongoose.Schema.Types.ObjectId,
  isMaster: Boolean,
  masterCampaignId: mongoose.Schema.Types.ObjectId,
  status: String,
  stats: {
    total: Number,
    sent: Number,
    delivered: Number,
    failed: Number
  }
}, { collection: 'campaigns' });

const Campaign = mongoose.model('Campaign', CampaignSchema);

async function checkMessages() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    // Get all campaigns
    const campaigns = await Campaign.find().sort({ createdAt: -1 }).limit(5).lean();
    console.log('\n=== Recent Campaigns ===');
    campaigns.forEach(c => {
      console.log(`Campaign: ${c.name} (${c._id})`);
      console.log(`  isMaster: ${c.isMaster || false}`);
      console.log(`  masterCampaignId: ${c.masterCampaignId || 'none'}`);
      console.log(`  status: ${c.status}`);
      console.log(`  stats.total: ${c.stats?.total || 0}`);
    });

    // Get total messages
    const totalMessages = await ContactCampaignMessage.countDocuments();
    console.log(`\n=== Total Messages: ${totalMessages} ===`);

    // Get sample message
    const sampleMessage = await ContactCampaignMessage.findOne().lean();
    if (sampleMessage) {
      console.log('\n=== Sample Message ===');
      console.log(`Phone: ${sampleMessage.recipientPhoneNumber}`);
      console.log(`UserId: ${sampleMessage.userId}`);
      console.log(`Campaigns in message: ${sampleMessage.campaigns?.length || 0}`);
      if (sampleMessage.campaigns && sampleMessage.campaigns.length > 0) {
        sampleMessage.campaigns.forEach((c, i) => {
          console.log(`  Campaign ${i + 1}: ${c.campaignId} (status: ${c.status})`);
        });
      }
    }

    // Count messages per campaign
    console.log('\n=== Messages per Campaign ===');
    const messageCounts = await ContactCampaignMessage.aggregate([
      { $unwind: '$campaigns' },
      { $group: { _id: '$campaigns.campaignId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    for (const mc of messageCounts) {
      const campaign = await Campaign.findById(mc._id).lean();
      console.log(`Campaign ${campaign?.name || 'Unknown'} (${mc._id}): ${mc.count} messages`);
    }

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkMessages();
