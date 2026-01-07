import express from 'express';
import authRoutes from './auth.routes.js';
import templateRoutes from './template.routes.js';
import campaignRoutes from './campaign.routes.js';
import messageRoutes from './message.routes.js';
import reportRoutes from './reports.routes.js';
import webhookRoutes from './webhook.routes.js';
import uploadRoutes from './upload.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import analyticsRoutes from './analytics.routes.js';
import walletRequestRoutes from './walletRequest.routes.js';
import contactCheckingRoutes from './contactChecking.routes.js';
import * as CampaignController from '../controller/campaign.controller.js';
import { authenticateToken, requireUser, requireAdmin } from '../middlewares/auth.middleware.js';


const router = express.Router();

// Direct capability check route (legacy endpoint)
router.post('/checkAvablityNumber', authenticateToken, requireUser, CampaignController.checkCapability);

// Campaign reports routes (moved from campaignReport.routes.js)
router.get('/campaign-reports/user/:userId', authenticateToken, CampaignController.getUserCampaignReports);
router.get('/campaign-reports/campaign/:id/messages', authenticateToken, CampaignController.getCampaignMessages);

// Admin campaign routes
router.get('/admin/campaigns/export/all', authenticateToken, requireAdmin, CampaignController.getAllCampaignsForExport);
router.get('/admin/campaigns/:campaignId/messages/all', authenticateToken, requireAdmin, CampaignController.getAllCampaignMessagesForExport);
router.get('/admin/campaigns/:id/messages', authenticateToken, requireAdmin, CampaignController.getCampaignMessages);
router.get('/admin/campaigns', authenticateToken, requireAdmin, CampaignController.getAllForAdmin);

router.use('/auth', authRoutes);
router.use('/templates', templateRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/messages', messageRoutes);
router.use('/reports', reportRoutes);
router.use('/uploads', uploadRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/wallet', walletRequestRoutes);
router.use('/contact-checking', contactCheckingRoutes);

router.use('/webhooks', webhookRoutes);



export default router;