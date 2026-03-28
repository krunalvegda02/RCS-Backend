import mongoose from 'mongoose';
import cron from 'node-cron';

// Payment expiration service
class PaymentExpirationService {
  constructor() {
    this.isRunning = false;
    this.EXPIRATION_MINUTES = 15; // Razorpay orders expire in 15 minutes
  }

  async expireOldPayments() {
    try {
      if (this.isRunning) {
        console.log('[PaymentExpiration] Already running, skipping...');
        return;
      }

      this.isRunning = true;
      console.log('[PaymentExpiration] Checking for expired payments...');

      const Payment = (await import('../models/payment.model.js')).default;
      
      const expirationTime = new Date(Date.now() - this.EXPIRATION_MINUTES * 60 * 1000);
      
      const expiredCount = await Payment.countDocuments({
        status: 'created',
        createdAt: { $lt: expirationTime }
      });

      if (expiredCount > 0) {
        console.log(`[PaymentExpiration] Found ${expiredCount} expired payments`);
        
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

        console.log(`[PaymentExpiration] ✅ Expired ${updateResult.modifiedCount} payments`);
      } else {
        console.log('[PaymentExpiration] No expired payments found');
      }

    } catch (error) {
      console.error('[PaymentExpiration] ❌ Error:', error.message);
    } finally {
      this.isRunning = false;
    }
  }

  start() {
    console.log('[PaymentExpiration] 🚀 Starting payment expiration service...');
    
    // Run every 5 minutes
    cron.schedule('*/5 * * * *', () => {
      this.expireOldPayments();
    });

    // Run once immediately
    setTimeout(() => {
      this.expireOldPayments();
    }, 5000);

    console.log('[PaymentExpiration] ✅ Service started (runs every 5 minutes)');
  }

  stop() {
    console.log('[PaymentExpiration] 🛑 Stopping payment expiration service...');
    // Note: node-cron doesn't provide easy way to stop specific tasks
    // You would need to track the task reference if you want to stop it
  }
}

export default new PaymentExpirationService();