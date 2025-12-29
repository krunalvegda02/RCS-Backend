import crypto from 'crypto';

const WEBHOOK_SECRET = process.env.JIO_WEBHOOK_SECRET;

export async function verifyWebhookSignature(req, res, next) {
  try {
    const signature = req.headers['x-jio-signature'];
    const timestamp = req.headers['x-jio-timestamp'];

    if (!signature || !timestamp) {
      return res.status(401).json({
        success: false,
        message: 'Missing signature or timestamp',
      });
    }

    // Verify timestamp (prevent replay attacks)
    const requestTime = parseInt(timestamp);
    const currentTime = Date.now();
    const timeDiff = Math.abs(currentTime - requestTime);

    if (timeDiff > 300000) { // 5 minutes
      return res.status(401).json({
        success: false,
        message: 'Request timestamp expired',
      });
    }

    // Verify signature
    const body = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(401).json({
        success: false,
        message: 'Invalid signature',
      });
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}
