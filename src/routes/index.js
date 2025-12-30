import express from 'express';
import authRoutes from './auth.routes.js';
import templateRoutes from './template.routes.js';
import campaignRoutes from './campaign.routes.js';
import messageRoutes from './message.routes.js';
import reportRoutes from './reports.routes.js';
import webhookRoutes from './webhook.routes.js';
import uploadRoutes from './upload.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import campaignReportRoutes from './campaignReport.routes.js';
import * as CampaignController from '../controller/campaign.controller.js';
import { authenticateToken, requireUser } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Direct capability check route (legacy endpoint)
router.post('/checkAvablityNumber', authenticateToken, requireUser, CampaignController.checkCapability);

router.use('/user', authRoutes);
router.use('/templates', templateRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/messages', messageRoutes);
router.use('/reports', reportRoutes);
router.use('/uploads', uploadRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/campaign-reports', campaignReportRoutes);

router.use('/webhooks', webhookRoutes);

export default router;