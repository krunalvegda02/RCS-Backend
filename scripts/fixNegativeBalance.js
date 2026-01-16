import mongoose from 'mongoose';
import connectDB from '../src/db/index.js';
import User from '../src/models/user.model.js';
import Campaign from '../src/models/campaign.model.js';
import dotenv from 'dotenv';
dotenv.config();

const fixNegativeBlockedBalance = async () => {
    try {
        await connectDB();
        console.log('✅ Connected to MongoDB');

        // Find users with negative blocked balance or just the specific user
        const users = await User.find({
            'wallet.blockedBalance': { $lt: 0 }
        });

        console.log(`Found ${users.length} users with negative blocked balance`);

        for (const user of users) {
            console.log(`Processing user: ${user.email} (Current Blocked: ${user.wallet.blockedBalance})`);

            // Find all active campaigns that SHOULD have blocked balance
            const activeCampaigns = await Campaign.find({
                userId: user._id,
                status: { $in: ['pending', 'processing', 'running', 'queued'] },
                blockedAmount: { $gt: 0 }
            });

            let calculatedBlockedBalance = 0;
            console.log(`Found ${activeCampaigns.length} active campaigns:`);

            for (const campaign of activeCampaigns) {
                console.log(` - Campaign ${campaign._id} (${campaign.status}): ₹${campaign.blockedAmount}`);
                calculatedBlockedBalance += campaign.blockedAmount;
            }

            console.log(`Calculated legitimate blocked balance: ₹${calculatedBlockedBalance}`);

            if (user.wallet.blockedBalance !== calculatedBlockedBalance) {
                console.log(`⚠️ Mismatch detected! Updating user wallet...`);

                // Update to the correct positive value
                // We use $set to force the correct value
                await User.findByIdAndUpdate(user._id, {
                    $set: {
                        'wallet.blockedBalance': calculatedBlockedBalance,
                        'wallet.lastUpdated': new Date()
                    }
                });

                console.log(`✅ Fixed blocked balance for ${user.email}. New value: ₹${calculatedBlockedBalance}`);
            } else {
                console.log(`Usage matches (strange for a negative balance user), skipping update.`);
            }
        }

        console.log('Done');
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

fixNegativeBlockedBalance();
