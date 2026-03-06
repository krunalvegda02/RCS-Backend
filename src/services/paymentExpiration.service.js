import cron from 'node-cron';
import Payment, { PAYMENT_STATUS } from '../models/payment.model.js';

const expireOldPayments = async () => {
  try {
    console.log('[Cron] Checking for abandoned payments...');
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const expiredPayments = await Payment.find({
      status: PAYMENT_STATUS.CREATED,
      createdAt: { $lt: tenMinutesAgo },
    });

    console.log(`[Cron] Found ${expiredPayments.length} payments to expire`);

    if (expiredPayments.length > 0) {
      for (const payment of expiredPayments) {
        await payment.markAsFailed({
          code: 'PAYMENT_TIMEOUT',
          description: 'Payment not completed within 10 minutes',
          reason: 'User abandoned payment',
        });
        console.log(`[Cron] ⏰ Expired: ${payment.razorpayOrderId}`);
      }
      console.log(`[Cron] ✅ Expired ${expiredPayments.length} abandoned payments`);
    }
  } catch (error) {
    console.error('[Cron] Error expiring payments:', error);
  }
};

export const startPaymentExpirationCron = () => {
  // Run immediately on startup to catch old payments
  expireOldPayments();
  
  // Then run every minute
  cron.schedule('* * * * *', expireOldPayments);

  console.log('✅ Payment expiration cron started (runs every minute, expires payments after 10 minutes)');
};
