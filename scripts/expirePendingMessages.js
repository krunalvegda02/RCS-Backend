import mongoose from 'mongoose';
import connectDB from '../db/index.js';

async function expirePendingMessages() {
  try {
    await connectDB();
    console.log('🔄 Starting pending message expiration job...');
    
    const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;
    
    // Find messages that are pending for more than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const result = await ContactCampaignMessage.updateMany(
      {
        'campaigns.status': 'pending',
        'createdAt': { $lt: fiveMinutesAgo }
      },
      {
        $set: {
          'campaigns.$.status': 'expired',
          'campaigns.$.failedAt': new Date(),
          'campaigns.$.errorCode': 'TIMEOUT',
          'campaigns.$.errorMessage': 'No webhook received within 5 minutes'
        }
      }
    );
    
    console.log(`✅ Expired ${result.modifiedCount} pending messages older than 5 minutes`);
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error expiring pending messages:', error);
    process.exit(1);
  }
}

expirePendingMessages();