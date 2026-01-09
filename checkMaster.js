import mongoose from 'mongoose';

const MONGO_URI = 'mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/test?retryWrites=true&w=majority';

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

async function checkMaster() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const masterId = '696105ac8096a6633cc0ef83';
    const master = await Campaign.findById(masterId).lean();
    
    console.log('\n=== Master Campaign ===');
    console.log(JSON.stringify(master, null, 2));

    const subCampaigns = await Campaign.find({ masterCampaignId: masterId }).lean();
    console.log(`\n=== Sub-campaigns: ${subCampaigns.length} ===`);
    subCampaigns.forEach(s => {
      console.log(`${s.name}: stats.total=${s.stats?.total || 0}`);
    });

    const totalRecipients = subCampaigns.reduce((sum, s) => sum + (s.stats?.total || 0), 0);
    console.log(`\nTotal recipients across all sub-campaigns: ${totalRecipients}`);

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkMaster();
