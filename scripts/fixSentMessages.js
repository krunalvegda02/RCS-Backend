import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';

async function fixSentMessages() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const ContactCampaignMessage = mongoose.model('ContactCampaignMessage', new mongoose.Schema({}, { strict: false }), 'contactcampaignmessages');

    // First, let's check what we have
    console.log('\n🔍 Checking current data...');
    const sentCount = await ContactCampaignMessage.countDocuments({ status: 'sent' });
    console.log(`Total messages with status 'sent': ${sentCount}`);
    
    const sentUpperCount = await ContactCampaignMessage.countDocuments({ status: 'SENT' });
    console.log(`Total messages with status 'SENT': ${sentUpperCount}`);
    
    const allStatuses = await ContactCampaignMessage.distinct('status');
    console.log(`All unique statuses in DB:`, allStatuses);
    
    const sentWithDelivered = await ContactCampaignMessage.countDocuments({
      status: { $in: ['sent', 'SENT'] },
      deliveredAt: { $exists: true, $ne: null }
    });
    console.log(`Messages with status 'sent'/'SENT' AND deliveredAt: ${sentWithDelivered}`);

    // Show a sample
    if (sentWithDelivered > 0) {
      const sample = await ContactCampaignMessage.findOne({
        status: { $in: ['sent', 'SENT'] },
        deliveredAt: { $exists: true, $ne: null }
      }).lean();
      console.log('\nSample message:', JSON.stringify({
        messageId: sample.messageId,
        phoneNumber: sample.phoneNumber,
        status: sample.status,
        sentAt: sample.sentAt,
        deliveredAt: sample.deliveredAt,
        readAt: sample.readAt
      }, null, 2));
    }

    // Fix sent → delivered (both lowercase and uppercase)
    console.log('\n🔄 Fixing sent messages with deliveredAt timestamp...');
    const deliveredResult = await ContactCampaignMessage.updateMany(
      {
        status: { $in: ['sent', 'SENT'] },
        deliveredAt: { $exists: true, $ne: null }
      },
      {
        $set: { status: 'delivered' }
      }
    );
    console.log(`✅ Fixed ${deliveredResult.modifiedCount} messages from 'sent' to 'delivered'`);

    // Fix sent/delivered → read
    console.log('\n🔄 Fixing messages with readAt timestamp...');
    const readResult = await ContactCampaignMessage.updateMany(
      {
        status: { $in: ['sent', 'SENT', 'delivered'] },
        readAt: { $exists: true, $ne: null }
      },
      {
        $set: { status: 'read' }
      }
    );
    console.log(`✅ Fixed ${readResult.modifiedCount} messages to 'read'`);

    console.log('\n✅ All done!');
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixSentMessages();