import { connectWithRetry, closeConnection, setupGracefulShutdown } from './mongoConnection.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

// Setup graceful shutdown
setupGracefulShutdown();

async function handleExpiredPayments() {
  try {
    console.log('🔍 Checking for expired payments...');
    
    await connectWithRetry();
    console.log('✅ MongoDB connected');

    const Payment = (await import('../src/models/payment.model.js')).default;

    // Define expiration time (15 minutes for Razorpay orders)
    const EXPIRATION_MINUTES = 15;
    const expirationTime = new Date(Date.now() - EXPIRATION_MINUTES * 60 * 1000);

    console.log(`⏰ Checking payments created before: ${expirationTime.toISOString()}`);

    // Find expired payments in 'created' status
    const expiredPayments = await Payment.find({
      status: 'created',
      createdAt: { $lt: expirationTime }
    }).populate('userId', 'name email');

    console.log(`📊 Found ${expiredPayments.length} expired payments`);

    if (expiredPayments.length === 0) {
      console.log('✅ No expired payments found');
      await mongoose.connection.close();
      return;
    }

    // Display expired payments details
    console.log('\n📋 EXPIRED PAYMENTS:');
    expiredPayments.forEach((payment, index) => {
      console.log(`${index + 1}. Payment ID: ${payment._id}`);
      console.log(`   Order ID: ${payment.razorpayOrderId}`);
      console.log(`   User: ${payment.userId?.name || 'Unknown'} (${payment.userId?.email || 'No email'})`);
      console.log(`   Amount: ₹${payment.amount}`);
      console.log(`   Created: ${payment.createdAt.toISOString()}`);
      console.log(`   Age: ${Math.round((Date.now() - payment.createdAt.getTime()) / (1000 * 60))} minutes`);
      console.log('   ---');
    });

    // Ask for confirmation (in production, you might want to auto-expire)
    console.log('\n⚠️  These payments will be marked as FAILED');
    
    // Mark expired payments as failed
    const updateResult = await Payment.updateMany(
      {
        status: 'created',
        createdAt: { $lt: expirationTime }
      },
      {
        $set: {
          status: 'failed',
          errorCode: 'PAYMENT_EXPIRED',
          errorDescription: 'Payment expired - not completed within time limit',
          errorReason: 'timeout'
        }
      }
    );

    console.log(`✅ Updated ${updateResult.modifiedCount} expired payments to 'failed' status`);

    // Show current payment status summary
    console.log('\n📊 CURRENT PAYMENT STATUS SUMMARY:');
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

    // Check for any remaining 'created' payments
    const remainingCreated = await Payment.countDocuments({ status: 'created' });
    if (remainingCreated > 0) {
      console.log(`\n⚠️  ${remainingCreated} payments still in 'created' status (recent ones)`);
      
      const recentCreated = await Payment.find({ status: 'created' })
        .select('razorpayOrderId amount createdAt')
        .sort({ createdAt: -1 })
        .limit(5);
      
      console.log('Recent created payments:');
      recentCreated.forEach(payment => {
        const ageMinutes = Math.round((Date.now() - payment.createdAt.getTime()) / (1000 * 60));
        console.log(`  - ${payment.razorpayOrderId}: ₹${payment.amount} (${ageMinutes} min ago)`);
      });
    }

    await closeConnection();
    console.log('\n🎉 Expired payment cleanup complete');

  } catch (error) {
    console.error('❌ Error:', error);
    await closeConnection();
    process.exit(1);
  }
}

handleExpiredPayments();