import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

// Import models
const Campaign = (await import('../models/campaign.model.js')).default;
const ContactCampaignMessage = (await import('../models/message.model.js')).default;
const Template = (await import('../models/template.model.js')).default;
const User = (await import('../models/user.model.js')).default;
const MessageLog = (await import('../models/messageLog.model.js')).default;

const seedTestData = async () => {
  try {
    console.log('🌱 Starting seed process...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get specific user
    let user = await User.findOne({ email: 'largemedia@gmail.com' });
    if (!user) {
      console.log('❌ User largemedia@gmail.com not found. Please check the email.');
      process.exit(1);
    }
    console.log(`✅ Using user: ${user.email}`);

    // Get first template for this user
    let template = await Template.findOne({ userId: user._id });
    if (!template) {
      console.log('❌ No template found for this user. Please create a template first.');
      process.exit(1);
    }
    console.log(`✅ Using template: ${template.name}`);

    // Generate 15 test phone numbers
    const generatePhoneNumbers = (count) => {
      const phones = [];
      for (let i = 1; i <= count; i++) {
        phones.push(`720100${String(i).padStart(4, '0')}`);
      }
      return phones;
    };

    const phoneNumbers = generatePhoneNumbers(15);
    console.log(`✅ Generated ${phoneNumbers.length} phone numbers`);

    // Create Campaign 1
    console.log('\n📊 Creating Campaign 1...');
    const campaign1 = await Campaign.create({
      name: 'Test Campaign - Summer Sale',
      userId: user._id,
      templateId: template._id,
      status: 'completed',
      isArchived: false,
      stats: {
        total: 15,
        sent: 15,
        delivered: 12,
        read: 8,
        replied: 3,
        failed: 3,
        bounced: 0,
        rcsCapable: 15
      },
      estimatedCost: 15,
      actualCost: 15,
      completedAt: new Date()
    });
    console.log(`✅ Campaign 1 created: ${campaign1._id}`);

    // Create Campaign 2
    console.log('\n📊 Creating Campaign 2...');
    const campaign2 = await Campaign.create({
      name: 'Test Campaign - New Product Launch',
      userId: user._id,
      templateId: template._id,
      status: 'pending',
      isArchived: false,
      stats: {
        total: 15,
        sent: 10,
        delivered: 8,
        read: 5,
        replied: 2,
        failed: 2,
        bounced: 0,
        rcsCapable: 15
      },
      estimatedCost: 15,
      actualCost: 10
    });
    console.log(`✅ Campaign 2 created: ${campaign2._id}`);

    // Create messages for Campaign 1 (all delivered/read/replied/failed)
    console.log('\n📱 Creating messages for Campaign 1...');
    const statuses1 = [
      'delivered', 'delivered', 'delivered', 'delivered', 'delivered',
      'read', 'read', 'read', 'read', 'read',
      'replied', 'replied', 'replied',
      'failed', 'failed'
    ];

    for (let i = 0; i < 15; i++) {
      const phone = phoneNumbers[i];
      const status = statuses1[i];
      const now = new Date();
      const sentAt = new Date(now.getTime() - 3600000); // 1 hour ago
      const deliveredAt = status !== 'failed' ? new Date(now.getTime() - 3000000) : null;
      const readAt = ['read', 'replied'].includes(status) ? new Date(now.getTime() - 1800000) : null;
      const messageId = `msg-${campaign1._id}-${phone}`;

      await ContactCampaignMessage.create({
        recipientPhoneNumber: phone,
        userId: user._id,
        campaignIds: [campaign1._id],
        campaigns: [{
          campaignId: campaign1._id,
          templateId: template._id,
          messageId: messageId,
          status: status,
          queuedAt: new Date(now.getTime() - 3700000),
          sentAt: sentAt,
          deliveredAt: deliveredAt,
          readAt: readAt,
          failedAt: status === 'failed' ? sentAt : null,
          errorCode: status === 'failed' ? 'NETWORK_ERROR' : null,
          errorMessage: status === 'failed' ? 'Network timeout' : null,
          userClickCount: ['read', 'replied'].includes(status) ? Math.floor(Math.random() * 3) : 0,
          userReplyCount: status === 'replied' ? 1 : 0,
          userText: status === 'replied' ? 'Interested! Please send more details.' : null,
          lastInteractionAt: readAt
        }]
      });

      // Create webhook logs for each message
      // 1. Message sent log
      await MessageLog.logMessageSend({
        messageId: messageId,
        campaignId: campaign1._id,
        userId: user._id,
        success: status !== 'failed',
        statusCode: status !== 'failed' ? 200 : 500,
        rcsMessageId: `rcs-${messageId}`,
        assistantId: 'test-assistant',
        cost: 1,
        responseTimeMs: 150
      });

      // 2. Delivered webhook (if delivered)
      if (deliveredAt) {
        await MessageLog.logWebhookEvent({
          messageId: messageId,
          campaignId: campaign1._id,
          userId: user._id,
          eventType: 'MESSAGE_DELIVERED',
          phoneNumber: phone,
          isUserInteraction: false,
          rawPayload: { status: 'delivered', timestamp: deliveredAt }
        });
      }

      // 3. Read webhook (if read)
      if (readAt) {
        await MessageLog.logWebhookEvent({
          messageId: messageId,
          campaignId: campaign1._id,
          userId: user._id,
          eventType: 'MESSAGE_READ',
          phoneNumber: phone,
          isUserInteraction: false,
          rawPayload: { status: 'read', timestamp: readAt }
        });
      }

      // 4. User interaction (if replied)
      if (status === 'replied') {
        await MessageLog.logWebhookEvent({
          messageId: messageId,
          campaignId: campaign1._id,
          userId: user._id,
          eventType: 'USER_MESSAGE',
          phoneNumber: phone,
          isUserInteraction: true,
          interactionType: 'text_reply',
          suggestionResponse: { text: 'Interested! Please send more details.' },
          rawPayload: { userText: 'Interested! Please send more details.', timestamp: readAt }
        });
      }

      // 5. Failed webhook (if failed)
      if (status === 'failed') {
        await MessageLog.create({
          messageId: messageId,
          campaignId: campaign1._id,
          userId: user._id,
          eventType: 'status_update',
          status: 'failed',
          error: {
            code: 'NETWORK_ERROR',
            message: 'Network timeout',
            type: 'network'
          },
          webhookData: {
            eventType: 'MESSAGE_FAILED',
            phoneNumber: phone,
            rawPayload: { error: 'Network timeout' }
          },
          timestamp: sentAt,
          metadata: { source: 'webhook' }
        });
      }
    }
    console.log(`✅ Created 15 messages for Campaign 1`);

    // Create messages for Campaign 2 (mix of sent/delivered/read/replied/failed)
    console.log('\n📱 Creating messages for Campaign 2...');
    const statuses2 = [
      'sent', 'sent', 'sent', 'sent', 'sent',
      'delivered', 'delivered', 'delivered',
      'read', 'read', 'read', 'read', 'read',
      'replied', 'replied'
    ];

    for (let i = 0; i < 15; i++) {
      const phone = phoneNumbers[i];
      const status = statuses2[i];
      const now = new Date();
      const sentAt = new Date(now.getTime() - 1800000); // 30 mins ago
      const deliveredAt = ['delivered', 'read', 'replied'].includes(status) ? new Date(now.getTime() - 1200000) : null;
      const readAt = ['read', 'replied'].includes(status) ? new Date(now.getTime() - 600000) : null;
      const messageId = `msg-${campaign2._id}-${phone}`;

      // Check if contact already exists
      let contact = await ContactCampaignMessage.findOne({
        recipientPhoneNumber: phone,
        userId: user._id
      });

      if (contact) {
        // Add campaign to existing contact
        contact.campaignIds.push(campaign2._id);
        contact.campaigns.push({
          campaignId: campaign2._id,
          templateId: template._id,
          messageId: messageId,
          status: status,
          queuedAt: new Date(now.getTime() - 1900000),
          sentAt: sentAt,
          deliveredAt: deliveredAt,
          readAt: readAt,
          userClickCount: ['read', 'replied'].includes(status) ? Math.floor(Math.random() * 2) : 0,
          userReplyCount: status === 'replied' ? 1 : 0,
          userText: status === 'replied' ? 'Yes, I want to know more!' : null,
          lastInteractionAt: readAt
        });
        await contact.save();
      } else {
        // Create new contact
        await ContactCampaignMessage.create({
          recipientPhoneNumber: phone,
          userId: user._id,
          campaignIds: [campaign2._id],
          campaigns: [{
            campaignId: campaign2._id,
            templateId: template._id,
            messageId: messageId,
            status: status,
            queuedAt: new Date(now.getTime() - 1900000),
            sentAt: sentAt,
            deliveredAt: deliveredAt,
            readAt: readAt,
            userClickCount: ['read', 'replied'].includes(status) ? Math.floor(Math.random() * 2) : 0,
            userReplyCount: status === 'replied' ? 1 : 0,
            userText: status === 'replied' ? 'Yes, I want to know more!' : null,
            lastInteractionAt: readAt
          }]
        });
      }

      // Create webhook logs for Campaign 2
      await MessageLog.logMessageSend({
        messageId: messageId,
        campaignId: campaign2._id,
        userId: user._id,
        success: true,
        statusCode: 200,
        rcsMessageId: `rcs-${messageId}`,
        assistantId: 'test-assistant',
        cost: 1,
        responseTimeMs: 120
      });

      if (deliveredAt) {
        await MessageLog.logWebhookEvent({
          messageId: messageId,
          campaignId: campaign2._id,
          userId: user._id,
          eventType: 'MESSAGE_DELIVERED',
          phoneNumber: phone,
          isUserInteraction: false,
          rawPayload: { status: 'delivered', timestamp: deliveredAt }
        });
      }

      if (readAt) {
        await MessageLog.logWebhookEvent({
          messageId: messageId,
          campaignId: campaign2._id,
          userId: user._id,
          eventType: 'MESSAGE_READ',
          phoneNumber: phone,
          isUserInteraction: false,
          rawPayload: { status: 'read', timestamp: readAt }
        });
      }

      if (status === 'replied') {
        await MessageLog.logWebhookEvent({
          messageId: messageId,
          campaignId: campaign2._id,
          userId: user._id,
          eventType: 'USER_MESSAGE',
          phoneNumber: phone,
          isUserInteraction: true,
          interactionType: 'text_reply',
          suggestionResponse: { text: 'Yes, I want to know more!' },
          rawPayload: { userText: 'Yes, I want to know more!', timestamp: readAt }
        });
      }
    }
    console.log(`✅ Created 15 messages for Campaign 2`);

    // Force sync campaigns from messages to update stats
    console.log('\n🔄 Syncing campaign stats from messages...');
    await campaign1.syncFromMessages(true);
    await campaign2.syncFromMessages(true);
    console.log('✅ Campaign stats synced');
    console.log('Campaign 1 stats after sync:', campaign1.stats);
    console.log('Campaign 2 stats after sync:', campaign2.stats);

    // Verify data
    console.log('\n🔍 Verifying data...');
    const campaignCount = await Campaign.countDocuments({ userId: user._id, isArchived: false });
    const messageCount = await ContactCampaignMessage.countDocuments({ userId: user._id });
    const webhookLogCount = await MessageLog.countDocuments({ userId: user._id });
    
    console.log(`✅ Total campaigns: ${campaignCount}`);
    console.log(`✅ Total contacts with messages: ${messageCount}`);
    console.log(`✅ Total webhook logs: ${webhookLogCount}`);

    // Test aggregation query
    console.log('\n🧪 Testing aggregation query...');
    const campaign1Stats = await ContactCampaignMessage.aggregate([
      { $match: { userId: user._id, 'campaigns.campaignId': campaign1._id } },
      { $unwind: '$campaigns' },
      { $match: { 'campaigns.campaignId': campaign1._id } },
      {
        $group: {
          _id: '$campaigns.status',
          count: { $sum: 1 }
        }
      }
    ]);
    console.log('Campaign 1 status breakdown:', campaign1Stats);

    console.log('\n✅ Seed completed successfully!');
    console.log('\n📋 Summary:');
    console.log(`   - Campaign 1: "${campaign1.name}" (${campaign1._id})`);
    console.log(`   - Campaign 2: "${campaign2.name}" (${campaign2._id})`);
    console.log(`   - Total contacts: ${messageCount}`);
    console.log(`   - Total webhook logs: ${webhookLogCount}`);
    console.log(`   - Phone numbers: ${phoneNumbers.slice(0, 5).join(', ')}...`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed error:', error);
    process.exit(1);
  }
};

seedTestData();
