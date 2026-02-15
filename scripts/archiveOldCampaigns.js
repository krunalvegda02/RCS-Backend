// import mongoose from 'mongoose';
// import ExcelJS from 'exceljs';
// import { v2 as cloudinary } from 'cloudinary';
// import { Readable } from 'stream';

// const MONGODB_URI = process.env.MONGODB_URI;

// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET
// });

// async function archiveOldCampaigns() {
//   try {
//     await mongoose.connect(MONGODB_URI);
//     console.log('[ArchiveCron] Connected to MongoDB');

//     const Campaign = mongoose.model('Campaign');
//     const ContactCampaignMessage = mongoose.model('ContactCampaignMessage');

//     // Calculate cutoff date (1.5 months ago)
//     const cutoffDate = new Date();
//     cutoffDate.setMonth(cutoffDate.getMonth() - 1);
//     cutoffDate.setDate(cutoffDate.getDate() - 15);

//     console.log(`[ArchiveCron] Finding campaigns older than ${cutoffDate.toISOString()}`);

//     // Find old campaigns
//     const oldCampaigns = await Campaign.find({
//       createdAt: { $lt: cutoffDate },
//       status: 'settled'
//     }).populate('userId', 'name email').lean();

//     if (oldCampaigns.length === 0) {
//       console.log('[ArchiveCron] No old campaigns to archive');
//       await mongoose.disconnect();
//       process.exit(0);
//     }

//     console.log(`[ArchiveCron] Found ${oldCampaigns.length} campaigns to archive`);

//     for (const campaign of oldCampaigns) {
//       try {
//         // Fetch campaign messages
//         const messages = await ContactCampaignMessage.find({ campaignId: campaign._id }).lean();

//         // Create Excel workbook
//         const workbook = new ExcelJS.Workbook();
//         const sheet = workbook.addWorksheet('Campaign Messages');
        
//         // Define columns
//         sheet.columns = [
//           { header: 'Campaign ID', key: 'campaignId', width: 25 },
//           { header: 'Campaign Name', key: 'campaignName', width: 30 },
//           { header: 'User Name', key: 'userName', width: 20 },
//           { header: 'User Email', key: 'userEmail', width: 25 },
//           { header: 'Bot ID', key: 'botId', width: 10 },
//           { header: 'Phone', key: 'phone', width: 15 },
//           { header: 'Status', key: 'status', width: 12 },
//           { header: 'Message ID', key: 'messageId', width: 30 },
//           { header: 'Sent At', key: 'sentAt', width: 20 },
//           { header: 'Delivered At', key: 'deliveredAt', width: 20 },
//           { header: 'Read At', key: 'readAt', width: 20 },
//           { header: 'Error', key: 'error', width: 30 },
//           { header: 'Campaign Created', key: 'campaignCreated', width: 20 },
//           { header: 'Campaign Completed', key: 'campaignCompleted', width: 20 },
//           { header: 'Total Messages', key: 'totalMessages', width: 15 },
//           { header: 'Sent Count', key: 'sentCount', width: 12 },
//           { header: 'Delivered Count', key: 'deliveredCount', width: 15 },
//           { header: 'Read Count', key: 'readCount', width: 12 },
//           { header: 'Failed Count', key: 'failedCount', width: 12 },
//           { header: 'Estimated Cost', key: 'estimatedCost', width: 15 },
//           { header: 'Actual Cost', key: 'actualCost', width: 12 },
//           { header: 'Refunded', key: 'refunded', width: 12 }
//         ];

//         // Add rows
//         sheet.addRows(messages.map(msg => ({
//           campaignId: campaign._id.toString(),
//           campaignName: campaign.name,
//           userName: campaign.userId?.name || 'N/A',
//           userEmail: campaign.userId?.email || 'N/A',
//           botId: campaign.botId,
//           phone: msg.phone,
//           status: msg.status,
//           messageId: msg.messageId || 'N/A',
//           sentAt: msg.sentAt?.toISOString() || 'N/A',
//           deliveredAt: msg.deliveredAt?.toISOString() || 'N/A',
//           readAt: msg.readAt?.toISOString() || 'N/A',
//           error: msg.error || 'N/A',
//           campaignCreated: campaign.createdAt?.toISOString() || 'N/A',
//           campaignCompleted: campaign.completedAt?.toISOString() || 'N/A',
//           totalMessages: campaign.stats?.total || 0,
//           sentCount: campaign.stats?.sent || 0,
//           deliveredCount: campaign.stats?.delivered || 0,
//           readCount: campaign.stats?.read || 0,
//           failedCount: campaign.stats?.failed || 0,
//           estimatedCost: campaign.estimatedCost || 0,
//           actualCost: campaign.actualCost || 0,
//           refunded: campaign.refundedAmount || 0
//         })));

//         // Style header row
//         sheet.getRow(1).font = { bold: true };
//         sheet.getRow(1).fill = {
//           type: 'pattern',
//           pattern: 'solid',
//           fgColor: { argb: 'FFE0E0E0' }
//         };

//         // Generate Excel buffer
//         const buffer = await workbook.xlsx.writeBuffer();

//         // Upload to Cloudinary
//         const uploadResult = await new Promise((resolve, reject) => {
//           const uploadStream = cloudinary.uploader.upload_stream(
//             {
//               resource_type: 'raw',
//               folder: 'archived_campaigns',
//               public_id: `campaign_${campaign._id}_${Date.now()}`,
//               format: 'xlsx'
//             },
//             (error, result) => {
//               if (error) reject(error);
//               else resolve(result);
//             }
//           );
//           Readable.from(buffer).pipe(uploadStream);
//         });

//         console.log(`[ArchiveCron] ✅ Archived campaign ${campaign._id} (${messages.length} messages) to: ${uploadResult.secure_url}`);

//         // Delete messages
//         const deletedMessages = await ContactCampaignMessage.deleteMany({ campaignId: campaign._id });
//         console.log(`[ArchiveCron] Deleted ${deletedMessages.deletedCount} messages for campaign ${campaign._id}`);

//         // Delete campaign
//         await Campaign.deleteOne({ _id: campaign._id });
//         console.log(`[ArchiveCron] Deleted campaign ${campaign._id}`);

//       } catch (error) {
//         console.error(`[ArchiveCron] ❌ Error archiving campaign ${campaign._id}:`, error.message);
//       }
//     }

//     console.log('[ArchiveCron] ✅ Archive process completed');
//     await mongoose.disconnect();
//     process.exit(0);

//   } catch (error) {
//     console.error('[ArchiveCron] ❌ Fatal error:', error);
//     await mongoose.disconnect();
//     process.exit(1);
//   }
// }

// archiveOldCampaigns();
