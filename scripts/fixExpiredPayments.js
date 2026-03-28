import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

async function fixExpiredPayments() {
  try {
    console.log('🔧 Fixing expired payments in "created" status...');
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');

    const Payment = (await import('../src/models/payment.model.js')).default;

    // Find all payments in 'created' status
    const createdPayments = await Payment.find({ status: 'created' })
      .populate('userId', 'name email')
      .sort({ createdAt: 1 });

    console.log(`📊 Found ${createdPayments.length} payments in "created" status`);

    if (createdPayments.length === 0) {
      console.log('✅ No payments in created status');
      await mongoose.connection.close();
      return;
    }

    console.log('\n📋 PAYMENTS IN "CREATED" STATUS:');
    createdPayments.forEach((payment, index) => {
      const ageMinutes = Math.round((Date.now() - payment.createdAt.getTime()) / (1000 * 60));
      const ageHours = Math.round(ageMinutes / 60);
      
      console.log(`${index + 1}. Payment ID: ${payment._id}`);
      console.log(`   Order ID: ${payment.razorpayOrderId}`);
      console.log(`   User: ${payment.userId?.name || 'Unknown'} (${payment.userId?.email || 'No email'})`);
      console.log(`   Amount: ₹${payment.amount}`);
      console.log(`   Created: ${payment.createdAt.toISOString()}`);
      console.log(`   Age: ${ageMinutes} minutes (${ageHours} hours)`);
      console.log(`   Status: Should be expired? ${ageMinutes > 15 ? '✅ YES' : '❌ NO (still valid)'}`);
      console.log('   ---');
    });

    // Expire payments older than 15 minutes
    const expiredPayments = createdPayments.filter(payment => {
      const ageMinutes = (Date.now() - payment.createdAt.getTime()) / (1000 * 60);
      return ageMinutes > 15;
    });

    if (expiredPayments.length === 0) {
      console.log('✅ No payments need to be expired (all are within 15 minutes)');
      await mongoose.connection.close();
      return;
    }

    console.log(`\n⚠️  ${expiredPayments.length} payments will be marked as FAILED (older than 15 minutes)`);

    // Update expired payments
    const expiredIds = expiredPayments.map(p => p._id);
    const updateResult = await Payment.updateMany(
      { _id: { $in: expiredIds } },
      {
        $set: {
          status: 'failed',
          errorCode: 'PAYMENT_EXPIRED',
          errorDescription: 'Payment expired - not completed within 15 minute time limit',
          errorReason: 'timeout'
        }
      }
    );

    console.log(`✅ Updated ${updateResult.modifiedCount} payments to 'failed' status`);

    // Show final status
    console.log('\n📊 FINAL PAYMENT STATUS SUMMARY:');
    const statusSummary = await Payment.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    statusSummary.forEach(item => {
      console.log(`  ${item._id}: ${item.count} payments (₹${item.totalAmount.toLocaleString('en-IN')})`);
    });

    await mongoose.connection.close();
    console.log('\n🎉 Expired payment fix complete');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixExpiredPayments();