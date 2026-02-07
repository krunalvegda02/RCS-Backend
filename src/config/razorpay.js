import Razorpay from 'razorpay';
import crypto from 'crypto';

// Initialize Razorpay instance
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Create a new Razorpay order
 * @param {number} amount - Amount in INR (will be converted to paise)
 * @param {string} currency - Currency code (default: INR)
 * @param {object} notes - Additional notes for the order
 * @returns {Promise<object>} Razorpay order object
 */
export const createRazorpayOrder = async (amount, currency = 'INR', notes = {}) => {
    const options = {
        amount: Math.round(amount * 100), // Razorpay expects amount in paise
        currency,
        notes,
        receipt: `receipt_${Date.now()}`,
    };

    try {
        const order = await razorpay.orders.create(options);
        return order;
    } catch (error) {
        console.error('[Razorpay] Error creating order:', error);
        throw new Error(`Failed to create payment order: ${error.message}`);
    }
};

/**
 * Verify Razorpay payment signature
 * @param {string} orderId - Razorpay order ID
 * @param {string} paymentId - Razorpay payment ID
 * @param {string} signature - Razorpay signature from client
 * @returns {boolean} True if signature is valid
 */
export const verifyPaymentSignature = (orderId, paymentId, signature) => {
    const body = orderId + '|' + paymentId;
    const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest('hex');

    return expectedSignature === signature;
};

/**
 * Verify Razorpay webhook signature
 * @param {string} body - Raw request body
 * @param {string} signature - X-Razorpay-Signature header
 * @returns {boolean} True if signature is valid
 */
export const verifyWebhookSignature = (body, signature) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.warn('[Razorpay] Webhook secret not configured');
        return false;
    }

    const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(body)
        .digest('hex');

    return expectedSignature === signature;
};

/**
 * Fetch payment details from Razorpay
 * @param {string} paymentId - Razorpay payment ID
 * @returns {Promise<object>} Payment details
 */
export const fetchPaymentDetails = async (paymentId) => {
    try {
        const payment = await razorpay.payments.fetch(paymentId);
        return payment;
    } catch (error) {
        console.error('[Razorpay] Error fetching payment:', error);
        throw new Error(`Failed to fetch payment details: ${error.message}`);
    }
};

/**
 * Get Razorpay Key ID for frontend
 */
export const getRazorpayKeyId = () => {
    return process.env.RAZORPAY_KEY_ID;
};

export default razorpay;
