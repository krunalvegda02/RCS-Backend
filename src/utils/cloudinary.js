import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
  cdn_subdomain: true,
});

// Debug log
console.log('[Cloudinary] Config:', {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY ? 'SET' : 'NOT SET',
  api_secret: process.env.CLOUDINARY_API_SECRET ? 'SET' : 'NOT SET'
});



// ====================================================
// FILE TYPE & SIZE CONFIGURATION
// ====================================================

export const UPLOAD_CONFIG = {
  // File type validation
  ALLOWED_MIME_TYPES: {
    image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    video: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'],
    document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  },

  // File size limits (in bytes)
  FILE_SIZE_LIMITS: {
    image: 50 * 1024 * 1024,           // 5MB
    video: 100 * 1024 * 1024,         // 100MB
    document: 10 * 1024 * 1024,       // 10MB
    thumbnail: 5 * 1024 * 1024        // 5MB
  },

  // Cloudinary folders for organization
  CLOUDINARY_FOLDERS: {
    templates: 'rcs-templates',
    richcards: 'rcs-templates/richcards',
    carousel: 'rcs-templates/carousel',
    campaigns: 'campaigns',
    kyc: 'kyc'
  },

  // Retry configuration
  RETRY: {
    maxAttempts: 3,
    initialDelay: 1000,        // 1 second
    maxDelay: 10000,           // 10 seconds
    backoffMultiplier: 2
  }
};

// ====================================================
// FILE VALIDATION UTILITIES
// ====================================================

export const validateFile = (file, uploadType) => {
  if (!file) {
    throw new Error('No file provided');
  }

  const allowedTypes = UPLOAD_CONFIG.ALLOWED_MIME_TYPES[uploadType] || UPLOAD_CONFIG.ALLOWED_MIME_TYPES.image;
  const sizeLimits = UPLOAD_CONFIG.FILE_SIZE_LIMITS[uploadType] || UPLOAD_CONFIG.FILE_SIZE_LIMITS.image;

  // Validate size
  if (file.size > sizeLimits) {
    throw new Error(
      `File too large (${uploadType}). Max: ${(sizeLimits / 1024 / 1024).toFixed(2)}MB, Got: ${(file.size / 1024 / 1024).toFixed(2)}MB`
    );
  }

  // Validate MIME type
  if (!allowedTypes.includes(file.mimetype)) {
    throw new Error(
      `Invalid file type (${uploadType}). Allowed: ${allowedTypes.join(', ')}`
    );
  }

  return true;
};

// ====================================================
// UPLOAD WITH RETRY & OPTIMIZATION
// ====================================================
export const uploadOnCloudinary = async (
  localFilePath,
  options = {}
) => {
  let attempts = 0;
  const maxAttempts = UPLOAD_CONFIG.RETRY.maxAttempts;

  const performUpload = async () => {
    try {
      if (!localFilePath || !fs.existsSync(localFilePath)) {
        throw new Error('File path invalid or file does not exist');
      }

      attempts++;
      console.log(`[Cloudinary] Upload attempt ${attempts}/${maxAttempts}: ${path.basename(localFilePath)}`);

      // Detect file type
      const isVideo = /\.(mp4|mov|webm|avi|quicktime)$/i.test(localFilePath);
      const isDocument = /\.(pdf|doc|docx)$/i.test(localFilePath);

      // Prepare upload options
      const uploadOptions = {
        // Resource type - use 'image' for documents (Cloudinary treats PDFs as images)
        resource_type: isVideo ? 'video' : options.resource_type || 'image',

        // Folder organization
        folder: options.folder || UPLOAD_CONFIG.CLOUDINARY_FOLDERS.templates,

        // Versioning for cache busting
        version: true,

        // Quality optimization (skip for documents)
        ...(!isDocument && { quality: 'auto:eco' }),

        // Image-specific optimizations
        ...((!isVideo && !isDocument) && {
          flags: 'progressive'
        }),

        // Video-specific optimizations
        ...(isVideo && {
          video_codec: 'h264',
          audio_codec: 'aac'
        }),

        // Override with custom options
        ...options
      };

      const uploadResult = await cloudinary.uploader.upload(
        localFilePath,
        uploadOptions
      );

      console.log('[Cloudinary] Upload successful:', uploadResult.secure_url);

      return uploadResult;

    } catch (error) {
      console.error(`[Cloudinary] Upload attempt ${attempts} failed:`, error.message);

      if (attempts < maxAttempts) {
        // Calculate backoff delay
        const delay = Math.min(
          UPLOAD_CONFIG.RETRY.initialDelay * Math.pow(
            UPLOAD_CONFIG.RETRY.backoffMultiplier,
            attempts - 1
          ),
          UPLOAD_CONFIG.RETRY.maxDelay
        );

        console.log(`[Cloudinary] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return performUpload();
      }

      throw error;
    }
  };

  try {
    const result = await performUpload();
    
    // Clean up temporary file
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
      console.log('[Cloudinary] Temporary file deleted:', path.basename(localFilePath));
    }

    return result;

  } catch (error) {
    // Ensure cleanup on final failure
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }

    console.error('[Cloudinary] Upload failed after all retries:', error.message);
    throw error;
  }
};

// ====================================================
// IMPROVED PUBLIC ID EXTRACTION
// ====================================================
export const extractPublicIdFromUrl = (url) => {
  try {
    if (!url) return null;

    // Handle both /image/, /video/, and /raw/ URLs
    const match = url.match(/\/(image|video|raw)\/upload\/(?:v\d+\/)?(.*?)(?:\?|$)/);
    
    if (match && match[2]) {
      // Remove file extension from public_id
      const publicId = match[2].replace(/\.[^.]+$/, '');
      console.log('[Cloudinary] Extracted public ID:', publicId);
      return publicId;
    }

    console.warn('[Cloudinary] Could not extract public ID from URL:', url);
    return null;

  } catch (error) {
    console.error('[Cloudinary] Error extracting public ID:', error.message);
    return null;
  }
};

// ====================================================
// DELETE FROM CLOUDINARY WITH CACHING
// ====================================================
export const deleteFromCloudinary = async (url) => {
  try {
    if (!url) {
      console.warn('[Cloudinary] Empty URL provided for deletion');
      return null;
    }

    console.log('[Cloudinary] Attempting to delete:', url);

    const publicId = extractPublicIdFromUrl(url);

    if (!publicId) {
      console.error('[Cloudinary] Could not extract public ID for deletion:', url);
      return null;
    }

    // Determine resource type from URL
    const isVideo = url.includes('/video/');
    const isRaw = url.includes('/raw/');
    const resourceType = isVideo ? 'video' : isRaw ? 'raw' : 'image';

    console.log(`[Cloudinary] Deleting ${resourceType}: ${publicId}`);

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true
    });

    console.log('[Cloudinary] Deletion result:', JSON.stringify(result));
    
    if (result.result === 'ok') {
      console.log(`✅ [Cloudinary] Successfully deleted: ${publicId}`);
    } else if (result.result === 'not found') {
      console.warn(`⚠️ [Cloudinary] File not found: ${publicId}`);
    } else {
      console.warn(`⚠️ [Cloudinary] Unexpected result: ${result.result}`);
    }

    return result;

  } catch (error) {
    console.error('[Cloudinary] Error deleting file:', error.message, error.stack);
    return null;
  }
};

// ====================================================
// BATCH DELETE UTILITY
// ====================================================
export const deleteMultipleFromCloudinary = async (urls) => {
  const results = [];
  const errors = [];

  for (const url of urls) {
    try {
      const result = await deleteFromCloudinary(url);
      results.push({ url, success: !!result });
    } catch (error) {
      errors.push({ url, error: error.message });
      results.push({ url, success: false });
    }
  }

  return { results, errors, successCount: results.filter(r => r.success).length };
};

// ====================================================
// ERROR HANDLER
// ====================================================
export const handleCloudinaryError = (error, context = {}) => {
  const errorResponse = {
    success: false,
    timestamp: new Date().toISOString(),
    context
  };

  // Cloudinary API errors
  if (error.status_code) {
    switch (error.status_code) {
      case 400:
        errorResponse.message = 'Invalid file format or parameters';
        errorResponse.statusCode = 400;
        break;
      case 401:
        errorResponse.message = 'Authentication failed with Cloudinary';
        errorResponse.statusCode = 500;
        break;
      case 403:
        errorResponse.message = 'Not authorized to perform this operation';
        errorResponse.statusCode = 403;
        break;
      case 404:
        errorResponse.message = 'File not found';
        errorResponse.statusCode = 404;
        break;
      case 429:
        errorResponse.message = 'Too many requests. Please try again later';
        errorResponse.statusCode = 429;
        break;
      default:
        errorResponse.message = 'Upload service error. Please try again.';
        errorResponse.statusCode = 500;
    }
  } else {
    // File system or network errors
    if (error.message.includes('ENOENT')) {
      errorResponse.message = 'File not found on server';
      errorResponse.statusCode = 400;
    } else if (error.message.includes('ENOMEM')) {
      errorResponse.message = 'Out of memory. File too large.';
      errorResponse.statusCode = 413;
    } else if (error.message.includes('timeout')) {
      errorResponse.message = 'Upload timeout. Please try again.';
      errorResponse.statusCode = 408;
    } else {
      errorResponse.message = 'Upload failed. Please try again.';
      errorResponse.statusCode = 500;
    }
  }

  // Add debugging info in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.debug = {
      originalMessage: error.message,
      stack: error.stack
    };
  }

  console.error('[Cloudinary Error]', errorResponse);
  return errorResponse;
};

// ====================================================
// LOGGER UTILITY
// ====================================================
export const logUploadEvent = (event, data) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    event,
    ...data
  };

  console.log(`[Cloudinary Event] ${JSON.stringify(logEntry)}`);
};

export default {
  uploadOnCloudinary,
  deleteFromCloudinary,
  deleteMultipleFromCloudinary,
  validateFile,
  extractPublicIdFromUrl,
  handleCloudinaryError,
  logUploadEvent,
  UPLOAD_CONFIG
};