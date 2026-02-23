import express from 'express';
import * as AuthController from '../controller/auth.controller.js';
import * as UserReportController from '../controller/userReport.controller.js';
import * as PendingUsersController from '../controller/pendingUsers.controller.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Public routes
router.post('/login', AuthController.login);
router.post('/login/2fa', AuthController.verifyLogin2FA);
router.post('/register', AuthController.register);
router.post('/refresh-token', AuthController.refreshToken);

// Protected routes
router.get('/profile', authenticateToken, AuthController.getProfile);
router.put('/profile', authenticateToken, AuthController.updateProfile);
router.put('/update-password', authenticateToken, AuthController.updatePassword);
router.put('/jio-config', authenticateToken, AuthController.updateJioConfig);
router.get('/jio-config', authenticateToken, AuthController.getJioConfig);
router.get('/user/my-report', authenticateToken, UserReportController.getMyReport);

// 2FA routes
router.post('/2fa/setup', authenticateToken, AuthController.setup2FA);
router.post('/2fa/verify', authenticateToken, AuthController.verify2FA);
router.post('/2fa/disable', authenticateToken, AuthController.disable2FA);

// Admin routes
router.post('/admin/create-user', authenticateToken, requireAdmin, AuthController.createUser);
router.get('/admin/users', authenticateToken, requireAdmin, AuthController.getAllUsers);
router.get('/admin/user-report/:userId', authenticateToken, requireAdmin, UserReportController.getUserReport);
router.put('/admin/user/:userId', authenticateToken, requireAdmin, AuthController.updateUser);
router.put('/admin/wallet/:userId', authenticateToken, requireAdmin, AuthController.updateWallet);
router.get('/admin/password/:userId', authenticateToken, requireAdmin, AuthController.getUserPassword);
router.put('/admin/password/:userId', authenticateToken, requireAdmin, AuthController.updateUserPassword);
router.get('/admin/transactions/:userId', authenticateToken, requireAdmin, AuthController.getUserTransactionHistory);
router.post('/admin/cleanup-blocked/:userId', authenticateToken, requireAdmin, AuthController.cleanupUserBlockedBalance);
router.post('/admin/cleanup-all-blocked', authenticateToken, requireAdmin, AuthController.cleanupAllBlockedBalances);
router.put('/admin/toggle-status/:userId', authenticateToken, requireAdmin, AuthController.toggleUserStatus);
router.post('/admin/unlock-account/:userId', authenticateToken, requireAdmin, AuthController.unlockUserAccount);
router.get('/admin/pending-users', authenticateToken, requireAdmin, PendingUsersController.getPendingUsers);
router.post('/admin/approve-user/:userId', authenticateToken, requireAdmin, PendingUsersController.approveUser);
router.delete('/admin/reject-user/:userId', authenticateToken, requireAdmin, PendingUsersController.rejectUser);
router.post('/admin/impersonate/:userId', authenticateToken, requireAdmin, AuthController.impersonateUser);
router.delete('/admin/users/:userId', authenticateToken, requireAdmin, AuthController.deleteUser);

export default router;