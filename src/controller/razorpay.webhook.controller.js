// import { verifyWebhookSignature } from '../config/razorpay.js';
// import Payment, { PAYMENT_STATUS } from '../models/payment.model.js';
// import User from '../models/user.model.js';
// // import WebhookLog from '../models/webhookLog.model.js';

// /**
//  * Handles Razorpay webhook events for payment processing
//  * @route POST /api/v1/razorpay/webhook
//  * @access Public (verified via signature)
//  */
// export const handleRazorpayWebhook = async (req, res) => {
//   console.log('\n🔔 Razorpay webhook received!');
  
//   // Respond immediately to Razorpay to prevent retries
//   res.json({ received: true });

//   try {
//     // Extract signature and body for verification
//     const signature = req.headers['x-razorpay-signature'];
//     const body = req.rawBody || JSON.stringify(req.body);

//     console.log('\n========== RAZORPAY WEBHOOK ==========');
//     console.log('Event:', req.body.event);
//     console.log('Payload:', JSON.stringify(req.body, null, 2));
//     console.log('Signature:', signature);
//     console.log('======================================\n');

//     // Log webhook for debugging and audit trail
//     const log = await WebhookLog.create({
//       event: req.body.event,
//       payload: req.body,
//       signature,
//     });

//     // Verify webhook signature to ensure it's from Razorpay
//     if (!verifyWebhookSignature(body, signature)) {
//       console.error('[Razorpay Webhook] Invalid signature');
//       log.error = 'Invalid signature';
//       await log.save();
//       return;
//     }

//     const event = req.body;
//     const eventType = event.event;

//     console.log(`[Razorpay Webhook] Received: ${eventType}`);

//     // Handle different webhook events
//     switch (eventType) {
//       // Payment successfully captured - add credits to user wallet
//       case 'payment.captured': {
//         const paymentData = event.payload.payment.entity;
//         const orderId = paymentData.order_id;
//         const paymentId = paymentData.id;

//         // Find payment record in database
//         const payment = await Payment.findOne({ razorpayOrderId: orderId });
//         if (!payment) {
//           console.warn(`[Razorpay Webhook] Order not found: ${orderId}`);
//           return;
//         }

//         // Prevent duplicate processing
//         if (payment.status === PAYMENT_STATUS.CAPTURED) {
//           console.log(`[Razorpay Webhook] Already processed: ${orderId}`);
//           log.processed = true;
//           await log.save();
//           return;
//         }

//         // Update payment status with payment details
//         await payment.markAsCaptured({
//           paymentId,
//           method: paymentData.method,
//           card: paymentData.card,
//           bank: paymentData.bank,
//           wallet: paymentData.wallet,
//           vpa: paymentData.vpa,
//         });

//         // Add credits to user wallet
//         const user = await User.findById(payment.userId);
//         if (user) {
//           await user.updateWallet(
//             payment.creditsToAdd,
//             'add',
//             `Razorpay Payment (Webhook) - ${orderId.slice(-8)}`,
//             null
//           );
//           console.log(`[Razorpay Webhook] ✅ Credits added: ${payment.creditsToAdd} for user ${user._id}`);
//         }
//         break;
//       }

//       // Payment failed - update payment status
//       case 'payment.failed': {
//         const paymentData = event.payload.payment.entity;
//         const orderId = paymentData.order_id;

//         const payment = await Payment.findOne({ razorpayOrderId: orderId });
//         if (payment && payment.status !== PAYMENT_STATUS.CAPTURED) {
//           await payment.markAsFailed({
//             code: paymentData.error_code,
//             description: paymentData.error_description,
//             reason: paymentData.error_reason,
//           });
//           console.log(`[Razorpay Webhook] ❌ Payment failed: ${orderId}`);
//         }
//         break;
//       }

//       // Payment authorized but not captured yet
//       case 'payment.authorized': {
//         const paymentData = event.payload.payment.entity;
//         const orderId = paymentData.order_id;
//         console.log(`[Razorpay Webhook] 🔐 Payment authorized: ${orderId}`);
//         break;
//       }

//       // Refund processed - deduct credits from user wallet
//       case 'refund.processed': {
//         const refundData = event.payload.refund.entity;
//         const paymentId = refundData.payment_id;
//         const refundAmount = refundData.amount / 100; // Convert paise to rupees

//         const payment = await Payment.findOne({ razorpayPaymentId: paymentId });
//         if (payment && payment.userId) {
//           const user = await User.findById(payment.userId);
//           if (user) {
//             await user.updateWallet(
//               refundAmount,
//               'deduct',
//               `Refund - Payment ${paymentId.slice(-8)}`,
//               null
//             );
//             console.log(`[Razorpay Webhook] 💸 Refund processed: ₹${refundAmount} deducted from user ${user._id}`);
//           }
//         }
//         break;
//       }

//       default:
//         console.log(`[Razorpay Webhook] ℹ️ Unhandled event: ${eventType}`);
//     }

//     // Mark webhook as processed
//     log.processed = true;
//     await log.save();
//   } catch (error) {
//     console.error('[Razorpay Webhook] Error:', error);
//   }
// };