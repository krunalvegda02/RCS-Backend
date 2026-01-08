import { Queue, Worker } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
};

export const campaignEntriesQueue = new Queue('campaign-entries', { connection });

const worker = new Worker('campaign-entries', async (job) => {
  const { campaignId, templateId, userId, phoneNumbers } = job.data;
  
  console.log(`[Queue] Processing ${phoneNumbers.length} entries for campaign ${campaignId}`);
  
  const CampaignMessage = (await import('../models/campaign_message_flat.model.js')).default;
  const Campaign = (await import('../models/campaign.model.js')).default;
  
  const phones = [...new Set(phoneNumbers.map(p => p.replace(/^\+?91/, "").replace(/\D/g, "")))];
  const docs = phones.map(phone => ({
    campaignId, userId, recipientPhoneNumber: phone, templateId,
    messageId: uuidv4(), status: "draft", queuedAt: new Date()
  }));
  
  await CampaignMessage.insertMany(docs, { ordered: false });
  await Campaign.findByIdAndUpdate(campaignId, { status: 'running' });
  
  console.log(`[Queue] ✅ Completed ${docs.length} entries for campaign ${campaignId}`);
}, { connection, concurrency: 2 });

worker.on('failed', async (job, err) => {
  console.error(`[Queue] Job ${job.id} failed:`, err);
  const Campaign = (await import('../models/campaign.model.js')).default;
  await Campaign.findByIdAndUpdate(job.data.campaignId, { status: 'failed' }).catch(console.error);
});

export default campaignEntriesQueue;
