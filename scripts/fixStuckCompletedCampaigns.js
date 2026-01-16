/**
 * Fix all campaigns that are marked as 'completed' but still have blockedAmount > 0
 * This script will properly adjust the wallet by calling completeCampaign()
 * 
 * Run with: node scripts/fixStuckCompletedCampaigns.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function fixStuckCompletedCampaigns() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('[Fix] Connected to MongoDB');

        // Import models
        const Campaign = (await import('../src/models/campaign.model.js')).default;
        const User = (await import('../src/models/user.model.js')).default;

        // Ensure ContactCampaignMessage model is registered
        await import('../src/models/contact_campaign_message.model.js');

        // Find all completed campaigns with blocked amounts
        const stuckCampaigns = await Campaign.find({
            status: 'completed',
            blockedAmount: { $gt: 0 }
        }).populate('userId', 'name email wallet');

        console.log(`[Fix] Found ${stuckCampaigns.length} completed campaigns with blocked amounts`);

        if (stuckCampaigns.length === 0) {
            console.log('[Fix] ✅ No stuck campaigns found');
            await mongoose.disconnect();
            process.exit(0);
        }

        let fixed = 0;
        let failed = 0;

        for (const campaign of stuckCampaigns) {
            try {
                console.log(`\n[Fix] Processing campaign ${campaign._id}`);
                console.log(`[Fix]   Name: "${campaign.name}"`);
                console.log(`[Fix]   User: ${campaign.userId?.email || 'Unknown'}`);
                console.log(`[Fix]   Status: ${campaign.status}`);
                console.log(`[Fix]   Blocked Amount: ₹${campaign.blockedAmount}`);
                console.log(`[Fix]   Stats: total=${campaign.stats?.total}, delivered=${campaign.stats?.delivered}`);

                // Get user's current wallet state
                const user = await User.findById(campaign.userId._id || campaign.userId);
                if (!user) {
                    console.log(`[Fix]   ❌ User not found, skipping`);
                    failed++;
                    continue;
                }

                console.log(`[Fix]   User wallet before: balance=₹${user.wallet.balance}, blocked=₹${user.wallet.blockedBalance}`);

                // Call completeCampaign to properly adjust wallet
                await campaign.completeCampaign();

                // Verify the fix
                const updatedCampaign = await Campaign.findById(campaign._id);
                const updatedUser = await User.findById(user._id);

                console.log(`[Fix]   ✅ Fixed!`);
                console.log(`[Fix]   Campaign blockedAmount: ${updatedCampaign.blockedAmount}`);
                console.log(`[Fix]   User wallet after: balance=₹${updatedUser.wallet.balance}, blocked=₹${updatedUser.wallet.blockedBalance}`);

                fixed++;
            } catch (error) {
                console.error(`[Fix]   ❌ Error: ${error.message}`);
                failed++;
            }
        }

        console.log(`\n[Fix] ========================================`);
        console.log(`[Fix] Summary: Fixed ${fixed}, Failed ${failed}`);
        console.log(`[Fix] ========================================`);

        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('[Fix] Fatal error:', error);
        process.exit(1);
    }
}

fixStuckCompletedCampaigns();
