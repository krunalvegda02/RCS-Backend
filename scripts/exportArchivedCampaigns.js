import { connectWithRetry, closeConnection, setupGracefulShutdown } from './mongoConnection.js';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

setupGracefulShutdown();

async function exportArchivedCampaigns() {
  try {
    await connectWithRetry();
    console.log('[Export] Connected to MongoDB');

    const ArchivedCampaign = (await import('../src/models/archivedCampaign.model.js')).default;

    const totalCount = await ArchivedCampaign.countDocuments();
    console.log(`[Export] Found ${totalCount} archived campaigns`);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Archived Campaigns');

    sheet.columns = [
      { header: 'S.No', key: 'sno', width: 8 },
      { header: 'Campaign ID', key: 'campaignId', width: 25 },
      { header: 'Campaign Name', key: 'campaignName', width: 30 },
      { header: 'User Name', key: 'userName', width: 20 },
      { header: 'User Email', key: 'userEmail', width: 30 },
      { header: 'Bot ID', key: 'botId', width: 15 },
      { header: 'Excel URL Part 1', key: 'excelUrlPart1', width: 100 },
      { header: 'Excel URL Part 2', key: 'excelUrlPart2', width: 100 },
      { header: 'Stats - Total', key: 'statsTotal', width: 12 },
      { header: 'Stats - Sent', key: 'statsSent', width: 12 },
      { header: 'Stats - Delivered', key: 'statsDelivered', width: 12 },
      { header: 'Stats - Read', key: 'statsRead', width: 12 },
      { header: 'Stats - Failed', key: 'statsFailed', width: 12 },
      { header: 'Stats - Pending', key: 'statsPending', width: 12 },
      { header: 'Stats - Expired', key: 'statsExpired', width: 12 },
      { header: 'Estimated Cost', key: 'estimatedCost', width: 15 },
      { header: 'Actual Cost', key: 'actualCost', width: 15 },
      { header: 'Refunded Amount', key: 'refundedAmount', width: 15 },
      { header: 'Campaign Completed At', key: 'campaignCompletedAt', width: 20 },
      { header: 'Archived At', key: 'archivedAt', width: 20 },
    ];

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    const BATCH_SIZE = 1000;
    let processedCount = 0;
    let rowIndex = 1;

    for (let skip = 0; skip < totalCount; skip += BATCH_SIZE) {
      const campaigns = await ArchivedCampaign.find({})
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean();

      const rows = campaigns.map(campaign => {
        let excelUrlPart1 = 'N/A';
        let excelUrlPart2 = '';
        
        if (campaign.excelParts && campaign.excelParts.length > 0) {
          const sortedParts = campaign.excelParts.sort((a, b) => a.partNumber - b.partNumber);
          excelUrlPart1 = sortedParts[0]?.url || 'N/A';
          excelUrlPart2 = sortedParts[1]?.url || '';
        } else if (campaign.excelUrl) {
          excelUrlPart1 = campaign.excelUrl;
          excelUrlPart2 = campaign.downloadUrl || '';
        }
        
        return {
          sno: rowIndex++,
          campaignId: campaign.campaignId || 'N/A',
          campaignName: campaign.campaignName || 'N/A',
          userName: campaign.userName || 'N/A',
          userEmail: campaign.userEmail || 'N/A',
          botId: campaign.botId || 'N/A',
          excelUrlPart1: excelUrlPart1,
          excelUrlPart2: excelUrlPart2,
          statsTotal: campaign.stats?.total || 0,
          statsSent: campaign.stats?.sent || 0,
          statsDelivered: campaign.stats?.delivered || 0,
          statsRead: campaign.stats?.read || 0,
          statsFailed: campaign.stats?.failed || 0,
          statsPending: campaign.stats?.pending || 0,
          statsExpired: campaign.stats?.expired || 0,
          estimatedCost: campaign.estimatedCost || 0,
          actualCost: campaign.actualCost || 0,
          refundedAmount: campaign.refundedAmount || 0,
          campaignCompletedAt: campaign.campaignCompletedAt ? new Date(campaign.campaignCompletedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
          archivedAt: campaign.archivedAt ? new Date(campaign.archivedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
        };
      });

      sheet.addRows(rows);
      processedCount += campaigns.length;
      console.log(`[Export] Processed ${processedCount}/${totalCount} campaigns`);
    }

    const outputPath = path.join(__dirname, `archived_campaigns_export_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(outputPath);

    console.log(`[Export] ✅ Excel file created: ${outputPath}`);
    console.log(`[Export] Total records: ${processedCount}`);

    await closeConnection();
    process.exit(0);

  } catch (error) {
    console.error('[Export] ❌ Error:', error);
    await closeConnection();
    process.exit(1);
  }
}

exportArchivedCampaigns();
