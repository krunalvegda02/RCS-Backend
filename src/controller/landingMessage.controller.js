import JioRCSService from '../services/JioRCS.service.js';

export const sendLandingMessage = async (req, res) => {
  try {
    const { phoneNumber, templateId } = req.body;

    console.log('[Landing Message] Request:', { phoneNumber, templateId });

    if (!phoneNumber || !templateId) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and template ID are required'
      });
    }

    const demoUserId = process.env.DEMO_USER_ID || req.body.userId;
    
    console.log('[Landing Message] Demo User ID:', demoUserId);

    if (!demoUserId) {
      return res.status(400).json({
        success: false,
        message: 'Demo user not configured. Please set DEMO_USER_ID in .env'
      });
    }

    const result = await JioRCSService.sendMessage(phoneNumber, templateId, demoUserId);

    res.status(200).json({
      success: true,
      message: 'Message sent successfully',
      data: result
    });
  } catch (error) {
    console.error('[Landing Message] Error:', error.message);
    console.error('[Landing Message] Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send message'
    });
  }
};
