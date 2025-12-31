import Message from '../models/message.model.js';
import MessageLog from '../models/messageLog.model.js';

// Get messages
export const getAll = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, campaignId } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    let query = { userId };
    
    // Sanitize status input - only allow string values
    if (status && typeof status === 'string') {
      query.status = status;
    }
    
    // Sanitize campaignId - validate it's a valid ObjectId format
    if (campaignId && typeof campaignId === 'string' && /^[0-9a-fA-F]{24}$/.test(campaignId)) {
      query.campaignId = campaignId;
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit);

    const total = await Message.countDocuments(query);

    res.json({
      success: true,
      data: messages,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get message details
export const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const message = await Message.findOne({
      messageId: id,
      userId,
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found',
      });
    }

    const messageLog = await MessageLog.findOne({ messageId: id }).lean();

    res.json({
      success: true,
      data: {
        message,
        messageLog,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get stats
export const getStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const { fromDate, toDate } = req.query;

    const query = { userId };
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(fromDate);
      if (toDate) query.createdAt.$lte = new Date(toDate);
    }

    const stats = await Message.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const daily = await Message.getDailyStats(userId, new Date());

    res.json({
      success: true,
      data: {
        byStatus: stats,
        daily,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};