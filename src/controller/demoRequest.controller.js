import DemoRequest from '../models/demoRequest.model.js';
import { sendEmail } from '../services/email.service.js';

const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || 'admin@rcsplatform.com';

export const createDemoRequest = async (req, res) => {
  try {
    const demoRequest = new DemoRequest(req.body);
    await demoRequest.save();

    // Send confirmation email to user
    await sendEmail(req.body.email, 'demoScheduled', {
      name: req.body.name,
      date: req.body.date,
      time: req.body.time,
      company: req.body.company
    });

    // Send notification to admin
    await sendEmail(ADMIN_EMAIL, 'adminDemoScheduled', {
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      company: req.body.company,
      date: req.body.date,
      time: req.body.time
    });

    res.status(201).json({ message: 'Demo request submitted successfully', data: demoRequest });
  } catch (error) {
    res.status(500).json({ message: 'Failed to submit demo request', error: error.message });
  }
};

export const getAllDemoRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const demoRequests = await DemoRequest.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ data: demoRequests });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch demo requests', error: error.message });
  }
};

export const updateDemoRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const demoRequest = await DemoRequest.findByIdAndUpdate(id, { status }, { new: true });
    res.status(200).json({ message: 'Status updated', data: demoRequest });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update status', error: error.message });
  }
};
