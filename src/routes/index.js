import express from 'express';
import authRoutes from './auth.routes.js';
import templateRoutes from './template.routes.js';
import campaignRoutes from './campaign.routes.js';
import messageRoutes from './message.routes.js';
import reportRoutes from './reports.routes.js';
import webhookRoutes from './webhook.routes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/templates', templateRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/messages', messageRoutes);
router.use('/reports', reportRoutes);
router.use('/webhooks', webhookRoutes);

export default router;