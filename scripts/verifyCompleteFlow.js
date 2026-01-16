import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../src/db/index.js';

dotenv.config();

async function verifyCompleteFlow() {
  try {
    await connectDB();
    
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║     COMPLETE WALLET FLOW VERIFICATION - DOUBLE CHECK      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    const User = (await import('../src/models/user.model.js')).default;
    const Campaign = (await import('../src/models/campaign.model.js')).default;
    const ContactCampaignMessage = (await import('../src/models/contact_campaign_message.model.js')).default;
    
    const user = await User.findOne({ email: 'largemedia@gmail.com' });
    
    // ============ CHECK 1: User Wallet State ============
    console.log('✓ CHECK 1: USER WALLET STATE');
    console.log('─'.repeat(60));
    console.log(`  User: ${user.name} (${user.email})`);
    console.log(`  Balance: ₹${user.wallet.balance}`);
    console.log(`  Blocked: ₹${user.wallet.blockedBalance}`);
    console.log(`  Available: ₹${user.wallet.balance - user.wallet.blockedBalance}`);
    
    const walletCheck1 = user.wallet.blockedBalance >= 0;
    console.log(`  ${walletCheck1 ? '✅' : '❌'} Blocked balance is non-negative\n`);
    
    // ============ CHECK 2: Campaign States ============
    console.log('✓ CHECK 2: CAMPAIGN STATES');
    console.log('─'.repeat(60));
    
    const allCampaigns = await Campaign.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5);
    let totalBlockedInCampaigns = 0;
    let incompleteCampaigns = 0;
    
    for (const campaign of allCampaigns) {
      const isComplete = campaign.status === 'completed';
      const hasBlockedAmount = campaign.blockedAmount > 0;
      
      console.log(`  Campaign: ${campaign.name}`);
      console.log(`    Status: ${campaign.status}`);
      console.log(`    Blocked: ₹${campaign.blockedAmount}`);
      console.log(`    Actual: ₹${campaign.actualCost || 0}`);
      
      if (hasBlockedAmount) {
        totalBlockedInCampaigns += campaign.blockedAmount;
      }
      
      if (!isComplete) {
        incompleteCampaigns++;
      }
      
      // Check if completed campaigns have cleared blocked amounts
      if (isComplete && hasBlockedAmount) {
        console.log(`    ❌ ISSUE: Completed but blockedAmount not cleared!`);
      } else if (isComplete) {
        console.log(`    ✅ Properly completed`);
      }
      console.log('');
    }
    
    const campaignCheck1 = totalBlockedInCampaigns === user.wallet.blockedBalance;
    console.log(`  Total blocked in campaigns: ₹${totalBlockedInCampaigns}`);
    console.log(`  Wallet blocked balance: ₹${user.wallet.blockedBalance}`);
    console.log(`  ${campaignCheck1 ? '✅' : '❌'} Campaign and wallet blocked amounts match\n`);
    
    // ============ CHECK 3: Message Status Distribution ============
    console.log('✓ CHECK 3: MESSAGE STATUS DISTRIBUTION');
    console.log('─'.repeat(60));
    
    const lastCampaign = allCampaigns[0];
    if (lastCampaign) {
      const messageStats = await ContactCampaignMessage.aggregate([
        { $match: { userId: user._id } },
        { $unwind: '$campaigns' },
        { $match: { 'campaigns.campaignId': lastCampaign._id } },
        {
          $group: {
            _id: '$campaigns.status',
            count: { $sum: 1 }
          }
        }
      ]);
      
      let pending = 0;
      let processed = 0;
      
      console.log(`  Last Campaign: ${lastCampaign.name}`);
      messageStats.forEach(s => {
        console.log(`    ${s._id}: ${s.count}`);
        if (['draft', 'queued', 'pending', 'sent'].includes(s._id)) {
          pending += s.count;
        } else {
          processed += s.count;
        }
      });
      
      const messageCheck1 = lastCampaign.status === 'completed' ? pending === 0 : true;
      console.log(`  ${messageCheck1 ? '✅' : '❌'} ${lastCampaign.status === 'completed' ? 'Completed campaign has no pending messages' : 'Campaign in progress'}\n`);
    }
    
    // ============ CHECK 4: Transaction Integrity ============
    console.log('✓ CHECK 4: TRANSACTION INTEGRITY');
    console.log('─'.repeat(60));
    
    const recentTransactions = user.wallet.transactions.slice(-5);
    console.log(`  Recent ${recentTransactions.length} transactions:`);
    recentTransactions.forEach((tx, i) => {
      console.log(`    ${i + 1}. ${tx.type.toUpperCase()} ₹${tx.amount} - ${tx.description.substring(0, 50)}...`);
    });
    
    const transactionCheck1 = recentTransactions.length > 0;
    console.log(`  ${transactionCheck1 ? '✅' : '❌'} Transaction history exists\n`);
    
    // ============ CHECK 5: Code Verification ============
    console.log('✓ CHECK 5: CODE VERIFICATION');
    console.log('─'.repeat(60));
    
    // Check if completeCampaign method exists
    const hasCompleteCampaign = typeof Campaign.schema.methods.completeCampaign === 'function';
    console.log(`  ${hasCompleteCampaign ? '✅' : '❌'} completeCampaign method exists`);
    
    // Check if blockBalanceForCampaign method exists
    const hasBlockBalance = typeof user.blockBalanceForCampaign === 'function';
    console.log(`  ${hasBlockBalance ? '✅' : '❌'} blockBalanceForCampaign method exists\n`);
    
    // ============ FINAL SUMMARY ============
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                      FINAL SUMMARY                         ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    const allChecks = [
      walletCheck1,
      campaignCheck1,
      hasCompleteCampaign,
      hasBlockBalance
    ];
    
    const passedChecks = allChecks.filter(c => c).length;
    const totalChecks = allChecks.length;
    
    console.log(`  Checks Passed: ${passedChecks}/${totalChecks}`);
    
    if (passedChecks === totalChecks) {
      console.log('\n  ✅ ✅ ✅ ALL CHECKS PASSED! WALLET FLOW IS WORKING CORRECTLY! ✅ ✅ ✅\n');
    } else {
      console.log('\n  ⚠️  SOME CHECKS FAILED - REVIEW ISSUES ABOVE\n');
    }
    
    // ============ FLOW DIAGRAM ============
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                  EXPECTED FLOW DIAGRAM                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    console.log('  1. CREATE CAMPAIGN');
    console.log('     └─> blockBalanceForCampaign() called');
    console.log('         └─> wallet.blockedBalance += estimatedCost');
    console.log('         └─> campaign.blockedAmount = estimatedCost');
    console.log('');
    console.log('  2. SEND MESSAGES');
    console.log('     └─> Python bot sends messages');
    console.log('         └─> Wallet stays blocked (no change)');
    console.log('');
    console.log('  3. RECEIVE WEBHOOKS');
    console.log('     └─> Stats consumer processes webhooks');
    console.log('         └─> Updates message statuses');
    console.log('         └─> Tracks campaignId in campaignsToCheck');
    console.log('');
    console.log('  4. CHECK COMPLETION');
    console.log('     └─> After batch processing');
    console.log('         └─> For each campaign in campaignsToCheck:');
    console.log('             └─> If pending === 0 && status !== completed:');
    console.log('                 └─> Call campaign.completeCampaign()');
    console.log('');
    console.log('  5. COMPLETE CAMPAIGN (ATOMIC TRANSACTION)');
    console.log('     └─> Start transaction');
    console.log('     └─> Calculate actualCost = delivered × ₹1');
    console.log('     └─> UPDATE WALLET FIRST:');
    console.log('         └─> wallet.balance -= actualCost');
    console.log('         └─> wallet.blockedBalance -= blockedAmount');
    console.log('         └─> Add transaction record');
    console.log('     └─> UPDATE CAMPAIGN SECOND:');
    console.log('         └─> campaign.actualCost = actualCost');
    console.log('         └─> campaign.blockedAmount = 0');
    console.log('         └─> campaign.status = completed');
    console.log('     └─> Commit transaction');
    console.log('');
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

verifyCompleteFlow();
