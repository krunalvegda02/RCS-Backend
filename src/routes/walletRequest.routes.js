import express from 'express';
import * as WalletRequestController from '../controller/walletRequest.controller.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.middleware.js';

const router = express.Router();

// User routes
router.post('/request', authenticateToken, WalletRequestController.createWalletRequest);
router.get('/my-requests', authenticateToken, WalletRequestController.getUserWalletRequests);

// Admin routes
router.get('/admin/requests', authenticateToken, requireAdmin, WalletRequestController.getAllWalletRequests);
router.put('/admin/approve/:requestId', authenticateToken, requireAdmin, WalletRequestController.approveWalletRequest);
router.put('/admin/reject/:requestId', authenticateToken, requireAdmin, WalletRequestController.rejectWalletRequest);
router.delete('/admin/delete/:requestId', authenticateToken, requireAdmin, WalletRequestController.deleteWalletRequest);

export default router;