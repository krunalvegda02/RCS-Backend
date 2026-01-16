import express from 'express';
import { uploadFile } from '../controller/upload.controller.js';
import { uploadImage } from '../utils/multerConfig.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Handle multer errors explicitly
const uploadMiddleware = (req, res, next) => {
  const upload = uploadImage.any();
  upload(req, res, (err) => {
    if (err) {
      console.error('[Upload] Multer error:', err);
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload failed'
      });
    }
    next();
  });
};

router.post('/uploadFile', authenticateToken, uploadMiddleware, uploadFile);

export default router;