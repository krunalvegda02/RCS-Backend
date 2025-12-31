import express from 'express';
import * as WebhookController from '../controller/webhook.controller.js';

const router = express.Router();



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


export default router;