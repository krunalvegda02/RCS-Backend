import express from 'express';
import * as ContactUploadController from '../controller/contactUpload.controller.js';
import { authenticateToken, requireUser } from '../middlewares/auth.middleware.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);
router.use(requireUser);

// Upload contacts and start capability check
router.post('/upload', ContactUploadController.uploadContacts);

// Get batch progress
router.get('/batch/:batchId/progress', ContactUploadController.getBatchProgress);

export default router;