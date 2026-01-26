import mongoose from 'mongoose';
import connectDB from '../src/db/index.js';

async function fixSentToDelivered() {
  try {
    await connectDB();
    console.log('🔄 Fixing sent messages with deliveredAt timestamp...');

    const ContactCampaignMessage = (await import('../src/models/contactMessage.model.js')).default;

    // Find messages with status 'sent' but have deliveredAt timestamp
    const result = await ContactCampaignMessage.updateMany(
      {
        status: 'sent',
        deliveredAt: { $exists: true, $ne: null }
      },
      {
        $set: { status: 'delivered' }
      }
    );

    console.log(`✅ Fixed ${result.modifiedCount} messages from 'sent' to 'delivered'`);

    // Also fix messages with readAt
    const readResult = await ContactCampaignMessage.updateMany(
      {
        status: { $in: ['sent', 'delivered'] },
        readAt: { $exists: true, $ne: null }
      },
      {
        $set: { status: 'read' }
      }
    );

    console.log(`✅ Fixed ${readResult.modifiedCount} messages to 'read'`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixSentToDelivered();
