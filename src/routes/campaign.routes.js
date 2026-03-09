import express from 'express';
import * as CampaignController from '../controller/campaign.controller.js';
import * as SubCampaignController from '../controller/subCampaign.controller.js';
import { authenticateToken, requireUser, requireAdmin, checkWalletBalance } from '../middlewares/auth.middleware.js';
import { requireOnboarded } from '../middlewares/onboarding.middleware.js';
import { cacheMiddleware } from '../middlewares/cache.middleware.js';

const router = express.Router();

// Admin routes (no user restriction)
router.get('/admin/campaigns/export/all', authenticateToken, requireAdmin, CampaignController.getAllCampaignsForExport);
router.get('/admin/campaigns/:campaignId/messages/all', authenticateToken, requireAdmin, CampaignController.getAllCampaignMessagesForExport);
router.get('/admin/campaigns/:id/messages', authenticateToken, requireAdmin, cacheMiddleware, CampaignController.getCampaignMessages);
router.get('/admin/campaigns', authenticateToken, requireAdmin, cacheMiddleware, CampaignController.getAllForAdmin);

// All other campaign routes require authentication and user role
router.use(authenticateToken);
router.use(requireUser);
router.use(requireOnboarded);

// Check RCS capability for batch of numbers
router.post('/check-capability', CampaignController.checkCapability);
router.get('/check-capability/progress', cacheMiddleware, CampaignController.getCapabilityProgress);

// Create campaign entries (bulk insert)
router.post('/create-entries', CampaignController.createCampaignEntries);

// Create master campaign with sub-campaigns
router.post('/master', SubCampaignController.createMasterCampaign);
router.post('/update-status', SubCampaignController.updateCampaignStatus);

// Batched contact upload
router.post('/batches/upload', CampaignController.uploadContactBatch);
router.post('/batches/:batchId/process', CampaignController.processContactBatch);
router.get('/batches/:campaignId', cacheMiddleware, CampaignController.getContactBatches);
router.get('/batches/:campaignId/with-data', cacheMiddleware, CampaignController.getContactBatchesWithData);
router.get('/batches/:batchId/details', cacheMiddleware, CampaignController.getContactBatchById);
router.get('/batches/:campaignId/contacts', cacheMiddleware, CampaignController.getAllContactsFromBatches);
router.get('/batches/:campaignId/reachable-users', cacheMiddleware, CampaignController.getReachableUsers);
router.delete('/batches/:campaignId/contacts/:phoneNumber', CampaignController.deleteContactFromBatch);

// Send bulk messages (create and start campaign)
router.post('/send-bulk', checkWalletBalance(1), CampaignController.create);

// Create simple campaign record (for contact upload integration)
router.post('/', CampaignController.createSimple);
router.get('/', cacheMiddleware, CampaignController.getAll);
router.get('/:id', cacheMiddleware, CampaignController.getById);
router.get('/:id/stats', cacheMiddleware, CampaignController.getStats);
router.post('/:id/refresh-stats', CampaignController.refreshStats);
router.post('/:id/sync-stats', CampaignController.refreshStats);
router.get('/:id/messages', cacheMiddleware, CampaignController.getCampaignMessages);
router.post('/:id/start', CampaignController.start);
router.post('/:id/pause', CampaignController.pause);
router.post('/:id/restart', CampaignController.restart);
router.post('/:id/complete', CampaignController.completeCampaign);

export default router;
