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
      company: req.body.company,
      meetingLink: req.body.meetingLink
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
    const demoRequests = await DemoRequest.find(filter)
      .sort({ createdAt: -1 })
      .lean();
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

export const updateDemoRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    const demoRequest = await DemoRequest.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!demoRequest) {
      return res.status(404).json({ message: 'Demo request not found' });
    }

    // Send updated schedule email to user if schedule fields updated
    if (updateData.meetingLink || updateData.date || updateData.time) {
      try {
        await sendEmail(demoRequest.email, 'demoScheduled', {
          name: demoRequest.name,
          date: demoRequest.date,
          time: demoRequest.time,
          company: demoRequest.company,
          meetingLink: demoRequest.meetingLink
        });
      } catch (emailError) {
        console.error('Email send failed:', emailError);
      }
    }

    res.status(200).json({ message: 'Demo request updated successfully', data: demoRequest });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update demo request', error: error.message });
  }
};

export const deleteDemoRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const demoRequest = await DemoRequest.findByIdAndDelete(id);
    
    if (!demoRequest) {
      return res.status(404).json({ message: 'Demo request not found' });
    }

    res.status(200).json({ message: 'Demo request deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete demo request', error: error.message });
  }
};
