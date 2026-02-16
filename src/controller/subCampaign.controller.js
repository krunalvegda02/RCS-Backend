import Campaign from '../models/campaign.model.js';
import Template from '../models/template.model.js';
import ContactCampaignMessage from '../models/contactMessage.model.js';
import { sendBatchEntriesToKafka } from '../services/kafka.service.js';
import crypto from 'crypto';

export const updateCampaignStatus = async (req, res) => {
  try {
    const { campaignId } = req.body;
    const userId = req.user._id;

    const campaign = await Campaign.findOne({ _id: campaignId, userId });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    campaign.status = 'pending';
    await campaign.save();

    console.log(`[Campaign] Status updated to pending for campaign ${campaignId}`);

    res.json({
      success: true,
      message: 'Campaign status updated to pending',
      data: { campaignId, status: 'pending' }
    });
  } catch (error) {
    console.error('[Campaign] Update status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createMasterCampaign = async (req, res) => {
  try {
    const { name, templateId, phoneNumbers } = req.body;
    const userId = req.user._id;

    console.log(`[Campaign] 🚀 Creating master campaign for user ${userId}`);
    console.log(`[Campaign] 📝 Campaign name: ${name}`);
    console.log(`[Campaign] 📱 Phone numbers count: ${phoneNumbers?.length || 0}`);

    if (!phoneNumbers || phoneNumbers.length === 0) {
      return res.status(400).json({ success: false, message: 'Phone numbers required' });
    }

    const template = await Template.findById(templateId);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    // Calculate estimated cost
    const estimatedCost = phoneNumbers.length * 1; // ₹1 per message
    console.log(`[Campaign] 💰 Estimated cost: ₹${estimatedCost} for ${phoneNumbers.length} contacts`);

    // Check and block wallet balance
    const User = (await import('../models/user.model.js')).default;
    const user = await User.findById(userId).select('+jioConfigs.clientSecret');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    console.log(`[Campaign] 👤 User wallet before: Balance=₹${user.wallet.balance}, Blocked=₹${user.wallet.blockedBalance || 0}`);

    const availableBalance = user.wallet.balance;

    if (availableBalance < estimatedCost) {
      return res.status(402).json({
        success: false,
        message: `Insufficient balance. Available: ₹${availableBalance}, Required: ₹${estimatedCost}`,
        required: estimatedCost,
        available: availableBalance
      });
    }

    const botId = await Campaign.findAvailableBot();

    const campaign = await Campaign.create({
      name,
      userId,
      templateId,
      botId,
      status: 'processing',
      payload: JSON.stringify(template.generatePayload()),
      estimatedCost,
      blockedAmount: estimatedCost,
      stats: {
        total: phoneNumbers.length,
        pending: phoneNumbers.length,
        sent: 0,
        delivered: 0,
        failed: 0
      }
    });

    // Block wallet balance
    console.log(`[Campaign] 🔄 Attempting to block ₹${estimatedCost} for campaign ${campaign._id}`);
    await user.blockBalanceForCampaign(estimatedCost, campaign._id);
    console.log(`[Campaign] 🔒 Blocked ₹${estimatedCost} for campaign ${campaign._id}. New blocked balance: ₹${user.wallet.blockedBalance}`);

    // Verify in database
    const verifyUser = await User.findById(userId);
    console.log(`[Campaign] ✅ Verified in DB: Balance=₹${verifyUser.wallet.balance}, Blocked=₹${verifyUser.wallet.blockedBalance}`);

    // Check if contacts < 100: manually add to MongoDB, else use Kafka
    if (phoneNumbers.length < 100) {
      console.log(`[Campaign] 📝 Small batch (${phoneNumbers.length} < 100), adding directly to MongoDB`);

      try {
        // Determine config count for multi-config round-robin
        const configCount = (user.isMultiConfig && user.jioConfigs?.length > 0)
          ? user.jioConfigs.length
          : 0;

        const entries = phoneNumbers.map((phoneNumber, i) => ({
          messageId: `${campaign._id}-${i}-${crypto.randomBytes(8).toString('hex')}`,
          recipientPhoneNumber: phoneNumber.replace('+91', ''),
          userId,
          campaignId: campaign._id,
          templateId,
          status: 'pending',
          queuedAt: new Date(),
          ...(configCount > 0 ? { configIndex: i % configCount } : {})
        }));

        await ContactCampaignMessage.insertMany(entries, { ordered: false });
        console.log(`[Campaign] ✅ Added ${phoneNumbers.length} contact entries to MongoDB`);

        campaign.status = 'pending';
        await campaign.save();

      } catch (error) {
        console.error('[Campaign] MongoDB insert failed:', error);
        // Rollback: delete campaign and unblock balance
        await Campaign.findByIdAndDelete(campaign._id);
        await User.findByIdAndUpdate(userId, {
          $inc: {
            'wallet.balance': estimatedCost,
            'wallet.blockedBalance': -estimatedCost
          }
        });
        return res.status(500).json({
          success: false,
          message: 'Failed to create campaign entries.',
          error: error.message
        });
      }
    } else {
      console.log(`[Campaign] 📤 Large batch (${phoneNumbers.length} >= 100), sending to Kafka`);

      // Determine config count for multi-config round-robin
      const configCount = (user.isMultiConfig && user.jioConfigs?.length > 0)
        ? user.jioConfigs.length
        : 0;

      // Send to Kafka for fast bulk processing
      const kafkaResult = await sendBatchEntriesToKafka({
        campaignId: campaign._id,
        templateId,
        userId,
        phoneNumbers,
        ...(configCount > 0 ? { configCount } : {})
      });

      if (!kafkaResult.success) {
        console.error('[Campaign] Kafka send failed:', kafkaResult.error);
        // Rollback: delete campaign and unblock balance
        await Campaign.findByIdAndDelete(campaign._id);
        await User.findByIdAndUpdate(userId, {
          $inc: {
            'wallet.balance': estimatedCost,
            'wallet.blockedBalance': -estimatedCost
          }
        });
        return res.status(500).json({
          success: false,
          message: 'Failed to queue campaign. Please try with fewer contacts or contact support.',
          error: kafkaResult.error
        });
      }
    }

    console.log(`[Campaign] ✅ Created campaign with ${phoneNumbers.length} contacts on ${botId}`);

    res.json({
      success: true,
      message: `Campaign created successfully on ${botId}`,
      data: {
        masterCampaign: campaign,
        subCampaignsCount: 1,
        totalContacts: phoneNumbers.length,
        botId
      }
    });
  } catch (error) {
    console.error('[Campaign] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};