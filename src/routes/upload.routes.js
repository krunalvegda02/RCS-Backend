import express from 'express';
import { uploadFile } from '../controller/upload.controller.js';
import { uploadImage } from '../utils/multerConfig.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/uploadFile', authenticateToken, uploadImage.single('file'), uploadFile);

export default router;