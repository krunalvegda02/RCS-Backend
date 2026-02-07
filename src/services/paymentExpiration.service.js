import cron from 'node-cron';
import Payment, { PAYMENT_STATUS } from '../models/payment.model.js';

export const startPaymentExpirationCron = () => {
  // Run every 1 minute for testing
  cron.schedule('*/10 * * * *', async () => {
    try {
      console.log('[Cron] Checking for abandoned payments...');
      // const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
      const tenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);


      const expiredPayments = await Payment.find({
        status: PAYMENT_STATUS.CREATED,
        createdAt: { $lt: tenMinutesAgo },
      });

      console.log(`[Cron] Found ${expiredPayments.length} payments to expire`);

      if (expiredPayments.length > 0) {
        for (const payment of expiredPayments) {
          await payment.markAsFailed({
            code: 'PAYMENT_TIMEOUT',
            description: 'Payment not completed within 3 minutes',
            reason: 'User abandoned payment',
          });
          console.log(`[Cron] ⏰ Expired: ${payment.razorpayOrderId}`);
        }
        console.log(`[Cron] ✅ Expired ${expiredPayments.length} abandoned payments`);
      }
    } catch (error) {
      console.error('[Cron] Error expiring payments:', error);
    }
  });

  console.log('✅ Payment expiration cron started (runs every 1 minute)');
};
