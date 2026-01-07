import express from 'express';
import * as CampaignController from '../controller/campaign.controller.js';
import { authenticateToken, requireUser, requireAdmin, checkWalletBalance } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Admin routes (no user restriction)
router.get('/admin/campaigns/export/all', authenticateToken, requireAdmin, CampaignController.getAllCampaignsForExport);
router.get('/admin/campaigns/:campaignId/messages/all', authenticateToken, requireAdmin, CampaignController.getAllCampaignMessagesForExport);
router.get('/admin/campaigns/:id/messages', authenticateToken, requireAdmin, CampaignController.getCampaignMessages);
router.get('/admin/campaigns', authenticateToken, requireAdmin, CampaignController.getAllForAdmin);

// All other campaign routes require authentication and user role
router.use(authenticateToken);
router.use(requireUser);

// Check RCS capability for batch of numbers
router.post('/check-capability', CampaignController.checkCapability);
router.get('/check-capability/progress', CampaignController.getCapabilityProgress);

// Create campaign entries (bulk insert)
router.post('/create-entries', CampaignController.createCampaignEntries);

// Batched contact upload
router.post('/batches/upload', CampaignController.uploadContactBatch);
router.post('/batches/:batchId/process', CampaignController.processContactBatch);
router.get('/batches/:campaignId', CampaignController.getContactBatches);
router.get('/batches/:campaignId/with-data', CampaignController.getContactBatchesWithData);
router.get('/batches/:batchId/details', CampaignController.getContactBatchById);
router.get('/batches/:campaignId/contacts', CampaignController.getAllContactsFromBatches);
router.get('/batches/:campaignId/reachable-users', CampaignController.getReachableUsers);
router.delete('/batches/:campaignId/contacts/:phoneNumber', CampaignController.deleteContactFromBatch);

// Send bulk messages (create and start campaign)
router.post('/send-bulk', checkWalletBalance(1), CampaignController.create);

// Create simple campaign record (for contact upload integration)
router.post('/', CampaignController.createSimple);
router.get('/', CampaignController.getAll);
router.get('/:id', CampaignController.getById);
router.get('/:id/stats', CampaignController.getStats);
router.get('/:id/messages', CampaignController.getCampaignMessages);
router.post('/:id/start', CampaignController.start);
router.post('/:id/pause', CampaignController.pause);
router.post('/:id/restart', CampaignController.restart);

export default router;
