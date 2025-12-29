import express from 'express';
import * as WebhookController from '../controller/webhook.controller.js';

const router = express.Router();

router.post('/jio/status', WebhookController.handleStatusUpdate);
router.post('/jio/delivery', WebhookController.handleDelivery);
router.post('/jio/read', WebhookController.handleRead);
router.post('/jio/reply', WebhookController.handleReply);

export default router;