import express from 'express';
import { uploadContacts, checkContactCapability } from '../controller/contactChecking.controller.js';
import { authenticateToken, requireUser } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/upload', authenticateToken, requireUser, uploadContacts);
router.get('/check/:campaignId', authenticateToken, requireUser, checkContactCapability);

export default router;
