import express from 'express';
import * as OnboardingController from '../controller/onboarding.controller.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.middleware.js';
import { requirePendingOnboarding } from '../middlewares/onboarding.middleware.js';

const router = express.Router();

// User routes (authenticated)
router.get('/status', authenticateToken, OnboardingController.getOnboardingStatus);
router.post('/submit', authenticateToken, requirePendingOnboarding, OnboardingController.submitOnboarding);

// Admin routes
router.get('/admin/pending', authenticateToken, requireAdmin, OnboardingController.getOnboardingRequests); // Keep for backward compatibility
router.get('/admin/requests', authenticateToken, requireAdmin, OnboardingController.getOnboardingRequests);
router.get('/admin/user/:userId', authenticateToken, requireAdmin, OnboardingController.getOnboardingDetails);
router.post('/admin/approve/:userId', authenticateToken, requireAdmin, OnboardingController.approveOnboarding);
router.post('/admin/reject/:userId', authenticateToken, requireAdmin, OnboardingController.rejectOnboarding);

export default router;
