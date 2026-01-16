import { uploadOnCloudinary, handleCloudinaryError } from '../utils/cloudinary.js';

export const uploadFile = async (req, res) => {
  try {
    console.log('[Upload] ========== REQUEST START ==========');
    console.log('[Upload] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('[Upload] Content-Type:', req.headers['content-type']);
    console.log('[Upload] req.file:', req.file);
    console.log('[Upload] req.files:', req.files);
    console.log('[Upload] req.body:', req.body);
    console.log('[Upload] ========== REQUEST END ==========');
    
    // Handle both single file and files array
    const file = req.file || (req.files && req.files[0]);
    
    if (!file) {
      console.error('[Upload] No file found in request');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    console.log('[Upload] File found:', file.originalname);
    console.log('[Upload] File path:', file.path);
    console.log('[Upload] Uploading to Cloudinary...');
    
    const result = await uploadOnCloudinary(file.path, {
      folder: 'rcs-templates',
      quality: 'auto:eco',
      flags: 'progressive'
    });

    console.log('[Upload] Success:', result.secure_url);
    res.json({
      success: true,
      data: {
        url: result.secure_url,
        publicId: result.public_id
      }
    });
  } catch (error) {
    console.error('[Upload] Error:', error);
    const errorResponse = handleCloudinaryError(error);
    res.status(errorResponse.statusCode || 500).json(errorResponse);
  }
};