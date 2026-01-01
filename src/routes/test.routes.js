import express from 'express';
import JioRCSService from '../services/JioRCS.service.js';
import { authenticateToken, requireUser } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Test batch capability check endpoint
router.post('/usersBatchget', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { phoneNumbers } = req.body;
    
    if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
      return res.status(400).json({
        success: false,
        message: 'phoneNumbers array is required'
      });
    }

    console.log(`Testing smart capability check for ${phoneNumbers.length} numbers`);
    
    // Use smart capability check (single API for ≤5, batch API for >5)
    const results = await JioRCSService.checkCapabilitySmart(phoneNumbers, req.user._id);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Format response
    const response = {
      success: true,
      data: {
        totalNumbers: phoneNumbers.length,
        processingTime: `${duration}ms`,
        results: results
      },
      performance: {
        totalTime: duration,
        averageTimePerNumber: Math.round(duration / phoneNumbers.length),
        numbersPerSecond: Math.round((phoneNumbers.length / duration) * 1000),
        apiUsed: phoneNumbers.length <= 5 ? 'single' : 'batch'
      }
    };

    console.log(`Smart capability check completed in ${duration}ms for ${phoneNumbers.length} numbers using ${response.performance.apiUsed} API`);
    console.log(`Performance: ${response.performance.numbersPerSecond} numbers/second`);
    
    res.json(response);
    
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.error('Smart capability check failed:', error);
    
    res.status(500).json({
      success: false,
      message: 'Smart capability check failed',
      error: error.message,
      processingTime: `${duration}ms`
    });
  }
});

export default router;