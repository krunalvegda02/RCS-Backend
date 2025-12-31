import express from 'express';
import * as WebhookController from '../controller/webhook.controller.js';

const router = express.Router();

// Test endpoint to verify webhook URL is accessible
router.get('/test', (req, res) => {
  console.log('[Webhook Test] GET request received');
  res.json({ 
    success: true, 
    message: 'Webhook endpoint is accessible',
    timestamp: new Date().toISOString(),
    headers: req.headers
  });
});

// Log all incoming webhook requests
router.use((req, res, next) => {
  console.log('='.repeat(80));
  console.log('[Webhook] Incoming request:', {
    method: req.method,
    path: req.path,
    url: req.url,
    headers: req.headers,
    body: req.body,
    timestamp: new Date().toISOString()
  });
  console.log('='.repeat(80));
  next();
});

router.post('/jio/rcs', WebhookController.webhookReceiver);

router.post('/jio/status', WebhookController.handleStatusUpdate);
router.post('/jio/delivery', WebhookController.handleDelivery);
router.post('/jio/read', WebhookController.handleRead);
router.post('/jio/reply', WebhookController.handleReply);

// Catch-all for any webhook format
router.post('/*', (req, res) => {
  console.log('🔔 [Webhook] Catch-all received:', {
    path: req.path,
    body: req.body,
    headers: req.headers
  });
  res.json({ success: true, message: 'Webhook received' });
});

export default router;