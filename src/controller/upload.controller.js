import { uploadOnCloudinary, handleCloudinaryError } from '../utils/cloudinary.js';

export const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const result = await uploadOnCloudinary(req.file.path, {
      folder: 'rcs-templates',
      quality: 'auto:eco',
      flags: 'progressive'
    });

    res.json({
      success: true,
      data: {
        url: result.secure_url,
        publicId: result.public_id
      }
    });
  } catch (error) {
    const errorResponse = handleCloudinaryError(error);
    res.status(errorResponse.statusCode || 500).json(errorResponse);
  }
};