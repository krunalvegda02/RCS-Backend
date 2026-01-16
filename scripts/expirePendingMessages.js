import mongoose from 'mongoose';
import connectDB from '../src/db/index.js';

async function expirePendingMessages() {
  try {
    await connectDB();
    console.log('🔄 Starting pending message expiration job...');
    
    const ContactCampaignMessage = (await import('../src/models/contact_campaign_message.model.js')).default;
    
    // Find messages that are pending OR sent for more than 5 minutes without response
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const result = await ContactCampaignMessage.updateMany(
      {
        'campaigns.status': { $in: ['pending', 'sent'] },
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
    
    console.log(`✅ Expired ${result.modifiedCount} pending/sent messages older than 5 minutes`);
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error expiring pending messages:', error);
    process.exit(1);
  }
}

expirePendingMessages();