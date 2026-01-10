import express from 'express';
import { handleWebhookWithKafka } from '../controller/webhookKafka.controller.js';

const router = express.Router();

// Kafka webhook endpoint (for 3000+ msg/sec)
router.post('/kafka', handleWebhookWithKafka);

export default router;