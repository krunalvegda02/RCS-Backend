import { Report } from '../models/APIReport.model.js';
import Message from '../models/message.model.js';

// Generate report
export const generate = async (req, res) => {
  try {
    const userId = req.user._id;
    const { reportType, startDate, endDate, campaignId } = req.body;

    const validTypes = ['daily', 'weekly', 'monthly', 'campaign'];
    if (!validTypes.includes(reportType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid report type',
      });
    }

    const query = {
      userId,
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };
    if (campaignId) query.campaignId = campaignId;

    const messages = await Message.find(query);
    const daily = await Message.getDailyStats(userId, new Date(startDate));

    const metrics = {
      totalMessages: messages.length,
      sentMessages: messages.filter(m => m.isSent).length,
      failedMessages: messages.filter(m => m.isFailed).length,
      deliveredMessages: messages.filter(m => m.status === 'delivered').length,
      readMessages: messages.filter(m => m.status === 'read').length,
      repliedMessages: messages.filter(m => m.status === 'replied').length,
    };

    metrics.successRate = metrics.totalMessages > 0
      ? (metrics.sentMessages / metrics.totalMessages) * 100
      : 0;

    const report = await Report.create({
      reportType,
      reportName: `${reportType} Report - ${startDate}`,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      userId,
      campaignId: campaignId || null,
      metrics,
      status: 'ready',
      generatedAt: new Date(),
      generatedBy: userId,
      dataSource: 'realtime',
    });

    res.status(201).json({
      success: true,
      message: 'Report generated successfully',
      data: report,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get reports
export const getAll = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const reports = await Report.find({ userId })
      .sort({ generatedAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit);

    const total = await Report.countDocuments({ userId });

    res.json({
      success: true,
      data: reports,
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