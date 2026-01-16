import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

async function adjustWallets() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const Campaign = (await import('../models/campaign.model.js')).default;
    const User = (await import('../models/user.model.js')).default;
    const ContactCampaignMessage = (await import('../models/contact_campaign_message.model.js')).default;

    // Find all completed campaigns
    const campaigns = await Campaign.find({
      status: 'completed'
    }).populate('userId', 'email companyname wallet');

    console.log(`📊 Found ${campaigns.length} completed campaigns to adjust\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const campaign of campaigns) {
      try {
        console.log(`\n🔄 Processing: ${campaign.name} (${campaign._id})`);
        console.log(`   User: ${campaign.userId?.companyname || campaign.userId?.email}`);
        
        // Get delivery stats
        const stats = await ContactCampaignMessage.aggregate([
          { $match: { userId: campaign.userId._id } },
          { $unwind: '$campaigns' },
          { $match: { 'campaigns.campaignId': campaign._id } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              delivered: {
                $sum: {
                  $cond: [{ $in: ['$campaigns.status', ['delivered', 'read', 'replied']] }, 1, 0]
                }
              },
              failed: {
                $sum: {
                  $cond: [{ $in: ['$campaigns.status', ['failed', 'bounced']] }, 1, 0]
                }
              },
              expired: {
                $sum: {
                  $cond: [{ $in: ['$campaigns.status', ['pending', 'queued', 'sent']] }, 1, 0]
                }
              }
            }
          }
        ]);

        const deliveryStats = stats[0] || { total: 0, delivered: 0, failed: 0, expired: 0 };
        
        console.log(`   📈 ${deliveryStats.delivered} delivered, ${deliveryStats.failed} failed, ${deliveryStats.expired} expired`);

        const actualCost = deliveryStats.delivered * 1;
        const estimatedCost = campaign.estimatedCost || deliveryStats.total;
        const refundAmount = Math.max(0, estimatedCost - actualCost);

        console.log(`   💰 Estimated: ₹${estimatedCost}, Actual: ₹${actualCost}, Refund: ₹${refundAmount}`);

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          campaign.actualCost = actualCost;
          campaign.refundedAmount = refundAmount;
          campaign.blockedAmount = estimatedCost;
          await campaign.save({ session });

          if (refundAmount > 0) {
            const user = await User.findById(campaign.userId._id).session(session);
            
            await User.findByIdAndUpdate(
              campaign.userId._id,
              {
                $inc: { 'wallet.balance': refundAmount },
                $set: { 'wallet.lastUpdated': new Date() },
                $push: {
                  'wallet.transactions': {
                    type: 'credit',
                    amount: refundAmount,
                    balanceAfter: user.wallet.balance + refundAmount,
                    description: `Adjustment: "${campaign.name}" - Refund ₹${refundAmount} (${deliveryStats.failed} failed + ${deliveryStats.expired} expired)`,
                    createdAt: new Date()
                  }
                }
              },
              { session }
            );
            
            console.log(`   ✅ Refunded ₹${refundAmount}`);
          } else if (actualCost > 0) {
            const user = await User.findById(campaign.userId._id).session(session);
            
            await User.findByIdAndUpdate(
              campaign.userId._id,
              {
                $inc: { 'wallet.balance': -actualCost },
                $set: { 'wallet.lastUpdated': new Date() },
                $push: {
                  'wallet.transactions': {
                    type: 'debit',
                    amount: actualCost,
                    balanceAfter: user.wallet.balance - actualCost,
                    description: `Adjustment: "${campaign.name}" - Charged ₹${actualCost} for ${deliveryStats.delivered} delivered`,
                    createdAt: new Date()
                  }
                }
              },
              { session }
            );
            
            console.log(`   ✅ Charged ₹${actualCost}`);
          }

          await session.commitTransaction();
          successCount++;
        } catch (error) {
          await session.abortTransaction();
          throw error;
        } finally {
          session.endSession();
        }
      } catch (error) {
        errorCount++;
        console.error(`   ❌ Error:`, error.message);
      }
    }

    console.log(`\n\n📊 Summary: ✅ ${successCount} adjusted, ❌ ${errorCount} errors`);

  } catch (error) {
    console.error('❌ Script error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected');
    process.exit(0);
  }
}

adjustWallets();
