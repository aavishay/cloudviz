// ─── PDF report ─────────────────────────────────────────────────────────────────
// Builds and downloads the "Export PDF" report. Loaded on demand (dynamic import) so jsPDF
// isn't part of the main bundle.

import { jsPDF } from 'jspdf';
import type { AzureResource } from '../components/types';

export interface OptimizationOpportunity {
  resource: AzureResource;
  reason: string;
  potentialSavings: number;
}

export interface PdfReportInput {
  // Response of /api/reports/enhanced (untyped in the app), or null when unavailable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reportData: any;
  totalResources: number;
  filteredTotalCost: number;
  budgetLimit: number;
  orphanedCount: number;
  optimizationOpportunities: OptimizationOpportunity[];
}

export function buildPdfReport({
  reportData,
  totalResources,
  filteredTotalCost,
  budgetLimit,
  orphanedCount,
  optimizationOpportunities,
}: PdfReportInput): void {

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 20;

  // Helper function to draw a colored bar chart
  const drawBar = (x: number, yPos: number, width: number, height: number, color: [number, number, number]) => {
    doc.setFillColor(color[0], color[1], color[2]);
    doc.rect(x, yPos - height, width, height, 'F');
  };

  // Helper function to draw a horizontal bar with label
  const drawHorizontalBar = (x: number, yPos: number, maxWidth: number, value: number, maxValue: number, color: [number, number, number], label: string, valueText: string) => {
    const barWidth = maxValue > 0 ? (value / maxValue) * maxWidth : 0;

    // Label
    doc.setFontSize(9);
    doc.setTextColor(60);
    doc.text(label, x, yPos);

    // Bar background
    doc.setFillColor(230, 230, 230);
    doc.rect(x + 60, yPos - 4, maxWidth, 6, 'F');

    // Colored bar
    if (barWidth > 0) {
      drawBar(x + 60, yPos - 1, barWidth, 6, color);
    }

    // Value text
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(valueText, x + 60 + maxWidth + 5, yPos);
  };

  // Title with colored header
  doc.setFillColor(16, 185, 129);
  doc.rect(0, 0, pageWidth, 35, 'F');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text('CloudViz Enhanced FinOps Report', pageWidth / 2, 22, { align: 'center' });

  // Generation info
  y = 45;
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 20, y);
  if (reportData?.reportPeriod) {
    doc.text(`Period: ${reportData.reportPeriod}`, pageWidth - 20, y, { align: 'right' });
  }
  y += 12;

  // Executive Summary with color highlight
  doc.setFillColor(240, 253, 244);
  doc.rect(15, y - 6, pageWidth - 30, 55, 'F');
  doc.setDrawColor(16, 185, 129);
  doc.setLineWidth(0.5);
  doc.rect(15, y - 6, pageWidth - 30, 55, 'S');

  doc.setFontSize(16);
  doc.setTextColor(16, 185, 129);
  doc.text('Executive Summary', 20, y);
  y += 10;

  doc.setFontSize(11);
  doc.setTextColor(30);
  if (reportData?.summary) {
    const summary = reportData.summary;
    const currentFormatted = `$${summary.totalCurrentMonthCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    const prevFormatted = `$${summary.totalPreviousMonthCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    const changeFormatted = `${summary.totalChangePercent >= 0 ? '+' : ''}${summary.totalChangePercent.toFixed(1)}%`;
    const changeColor = summary.totalChange > 0 ? [220, 38, 38] : [16, 185, 129];

    doc.text(`Total Current Month Cost:`, 25, y); y += 7;
    doc.setFontSize(14);
    doc.setTextColor(16, 185, 129);
    doc.text(currentFormatted, 35, y); y += 12;

    doc.setFontSize(11);
    doc.setTextColor(30);
    doc.text(`Previous Month: ${prevFormatted}`, 25, y); y += 7;
    doc.text(`Change: `, 25, y);
    doc.setTextColor(changeColor[0], changeColor[1], changeColor[2]);
    doc.text(changeFormatted, 45, y); y += 10;

    doc.setTextColor(60);
    doc.setFontSize(10);
    doc.text(`Total Resource Groups: ${summary.totalResourceGroups}`, 25, y); y += 6;
    doc.text(`Total Resources: ${summary.totalResources.toLocaleString()}`, 25, y); y += 6;
    doc.text(`Avg Cost/Resource: $${summary.avgCostPerResource.toFixed(2)}`, 25, y); y += 6;
  } else {
    // Fallback to existing data
    doc.text(`Total Monthly Cost: $${(filteredTotalCost || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, 25, y); y += 7;
    doc.text(`Total Resources: ${(totalResources || 0).toLocaleString()}`, 25, y); y += 7;
    doc.text(`Orphaned Resources: ${orphanedCount || 0}`, 25, y); y += 7;
  }
  y += 10;

  // Resource Group Cost Breakdown with colorful bars
  if (reportData?.resourceGroupReports && reportData.resourceGroupReports.length > 0) {
    if (y > 200) { doc.addPage(); y = 20; }

    doc.setFontSize(14);
    doc.setTextColor(30);
    doc.text('Resource Group Cost Breakdown', 20, y);
    y += 8;

    // Sort by current cost descending
    const sortedRGs = [...reportData.resourceGroupReports].sort((a, b) => b.currentMonthCost - a.currentMonthCost).slice(0, 10);
    const maxCost = Math.max(...sortedRGs.map(rg => rg.currentMonthCost));

    doc.setFontSize(9);
    sortedRGs.forEach((rg, idx) => {
      const colors: [number, number, number][] = [
        [16, 185, 129], [59, 130, 246], [139, 92, 246], [249, 115, 22], [236, 72, 153],
        [14, 165, 233], [168, 85, 247], [234, 179, 8], [239, 68, 68], [100, 116, 139]
      ];
      const color = colors[idx % colors.length];
      const changeText = rg.costChange >= 0 ? `+${rg.costChangePercent.toFixed(1)}%` : `${rg.costChangePercent.toFixed(1)}%`;

      const label = rg.resourceGroup.length > 20 ? rg.resourceGroup.substring(0, 20) + '...' : rg.resourceGroup;
      const valueText = `$${rg.currentMonthCost.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${changeText})`;

      drawHorizontalBar(20, y, 90, rg.currentMonthCost, maxCost, color, label, valueText);
      y += 10;
      if (y > 270) { doc.addPage(); y = 20; }
    });
    y += 8;
  }

  // Top Cost Changes section
  if (reportData?.topChanges && reportData.topChanges.length > 0) {
    if (y > 230) { doc.addPage(); y = 20; }

    doc.setFontSize(14);
    doc.setTextColor(30);
    doc.text('Top Cost Changes', 20, y);
    y += 10;

    doc.setFontSize(10);
    reportData.topChanges.slice(0, 8).forEach((change: any) => {
      const changeIcon = change.changeType === 'increased' ? '▲' : change.changeType === 'decreased' ? '▼' : '●';
      const changeTextColor = change.changeAmount > 0 ? [220, 38, 38] : change.changeAmount < 0 ? [16, 185, 129] : [100, 116, 139];

      doc.setTextColor(changeTextColor[0], changeTextColor[1], changeTextColor[2]);
      doc.text(changeIcon, 25, y);
      doc.setTextColor(60);
      doc.text(`${change.resourceGroup}`, 35, y);
      doc.text(`${change.changeType.toUpperCase()}`, 90, y);
      doc.text(`$${Math.abs(change.changeAmount).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 140, y);
      doc.text(`${change.changePercent >= 0 ? '+' : ''}${change.changePercent.toFixed(1)}%`, pageWidth - 30, y, { align: 'right' });
      y += 8;
      if (y > 270) { doc.addPage(); y = 20; }
    });
    y += 8;
  }

  // Daily Trends Visualization
  if (reportData?.costTrends && reportData.costTrends.length > 0) {
    reportData.costTrends.forEach((trend: any) => {
      if (y > 180) { doc.addPage(); y = 20; }

      doc.setFontSize(14);
      doc.setTextColor(30);
      doc.text(`Daily Cost Trends - ${trend.subscriptionName}`, 20, y);
      y += 12;

      // Daily comparison chart
      if (trend.dailyTrends && trend.dailyTrends.length > 0) {
        const chartData = trend.dailyTrends.slice(-15); // Last 15 days

        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text('Day', 20, y);
        doc.text('Current', 50, y);
        doc.text('Previous', 80, y);
        doc.text('Change', 110, y);
        y += 6;

        chartData.forEach((day: any) => {
          const changeText = day.changePercent >= 0 ? `+${day.changePercent.toFixed(0)}%` : `${day.changePercent.toFixed(0)}%`;
          const changeColor = day.change > 0 ? [220, 38, 38] : day.change < 0 ? [16, 185, 129] : [100, 116, 139];

          doc.setTextColor(60);
          doc.text(day.date, 20, y);
          doc.text(`$${day.currentMonth.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 50, y);
          doc.text(`$${day.previousMonth.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 80, y);
          doc.setTextColor(changeColor[0], changeColor[1], changeColor[2]);
          doc.text(changeText, 110, y);
          y += 6;
          if (y > 270) { doc.addPage(); y = 20; }
        });

        // Summary for this subscription
        y += 4;
        doc.setFontSize(9);
        doc.setTextColor(60);
        const projectedText = `$${trend.projectedMonthEnd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
        doc.text(`Current Month Total: $${trend.currentMonthTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 25, y);
        y += 6;
        doc.text(`Previous Month: $${trend.previousMonthTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 25, y);
        y += 6;
        doc.text(`Projected Month-End: ${projectedText}`, 25, y);
        y += 12;
      }
    });
  }

  // Top Resource Groups Detail
  if (reportData?.resourceGroupReports && reportData.resourceGroupReports.length > 0) {
    if (y > 200) { doc.addPage(); y = 20; }

    doc.setFontSize(14);
    doc.setTextColor(30);
    doc.text('Top Resource Groups Detail', 20, y);
    y += 10;

    const topRGs = reportData.resourceGroupReports
      .sort((a: any, b: any) => b.currentMonthCost - a.currentMonthCost)
      .slice(0, 5);

    topRGs.forEach((rg: any) => {
      if (y > 240) { doc.addPage(); y = 20; }

      // RG header with subtle background
      doc.setFillColor(248, 250, 252);
      doc.rect(15, y - 6, pageWidth - 30, 35, 'F');

      doc.setFontSize(11);
      doc.setTextColor(30);
      doc.text((rg as any).resourceGroup, 20, y);
      y += 7;

      doc.setFontSize(9);
      doc.setTextColor(60);
      doc.text(`Subscription: ${(rg as any).subscriptionName}`, 25, y); y += 5;
      doc.text(`Resources: ${(rg as any).resourceCount}`, 25, y); y += 5;
      doc.text(`Cost: $${(rg as any).currentMonthCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, 25, y);

      const changeText = `${rg.costChange >= 0 ? '+' : ''}$${rg.costChange.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${rg.costChangePercent >= 0 ? '+' : ''}${rg.costChangePercent.toFixed(1)}%)`;
      const changeColor = rg.costChange > 0 ? [220, 38, 38] : [16, 185, 129];
      doc.setTextColor(changeColor[0], changeColor[1], changeColor[2]);
      doc.text(changeText, 120, y);
      y += 10;

      // Top resources in this RG
      if (rg.topCostResources && rg.topCostResources.length > 0) {
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text('Top Resources:', 25, y); y += 5;

        (rg as any).topCostResources.slice(0, 3).forEach((res: any) => {
          doc.setTextColor(80);
          doc.text(`• ${res.resourceName} (${res.resourceType.split('/').pop()})`, 30, y);
          doc.text(`$${res.monthlyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, pageWidth - 35, y, { align: 'right' });
          y += 5;
        });
      }

      // Day-by-day cost chart for this RG (if available)
      if (rg.costByDay && rg.costByDay.length > 0) {
        y += 2;
        doc.setFontSize(7);
        doc.setTextColor(120);
        doc.text('Daily Cost Trend:', 25, y);
        y += 4;

        // Show last 7 days
        const lastDays = rg.costByDay.slice(-7);
        const maxDayCost = Math.max(...lastDays.map((d: any) => d.cost || 0));

        // Draw mini bar chart
        const barWidth = 6;
        const spacing = 2;
        const startX = 25;

        lastDays.forEach((day: any, idx: number) => {
          const barHeight = maxDayCost > 0 ? (day.cost / maxDayCost) * 15 : 0;
          const x = startX + idx * (barWidth + spacing);

          // Color based on cost level
          const intensity = maxDayCost > 0 ? day.cost / maxDayCost : 0;
          const color: [number, number, number] = intensity > 0.7 ? [239, 68, 68] :
                                                 intensity > 0.4 ? [234, 179, 8] :
                                                 [16, 185, 129];

          // Draw bar
          doc.setFillColor(color[0], color[1], color[2]);
          doc.rect(x, y - barHeight, barWidth, barHeight, 'F');

          // Day label
          doc.setTextColor(100);
          doc.text(day.date.substring(0, 2), x + 1, y + 4);
        });
        y += 20;
      } else {
        y += 10;
      }
    });
  }

  // Day-by-Day Cost Summary Section
  if (reportData?.costTrends && reportData.costTrends.length > 0) {
    if (y > 200) { doc.addPage(); y = 20; }

    doc.setFillColor(240, 249, 255);
    doc.rect(15, y - 6, pageWidth - 30, 10, 'F');
    doc.setDrawColor(14, 165, 233);
    doc.setLineWidth(0.5);
    doc.rect(15, y - 6, pageWidth - 30, 10, 'S');

    doc.setFontSize(14);
    doc.setTextColor(14, 165, 233);
    doc.text('Day-by-Day Cost Analysis', 20, y);
    y += 12;

    reportData.costTrends.forEach((trend: any) => {
      if (y > 220) { doc.addPage(); y = 20; }

      doc.setFontSize(11);
      doc.setTextColor(60);
      doc.text(`Subscription: ${trend.subscriptionName}`, 25, y);
      y += 8;

      if (trend.dailyTrends && trend.dailyTrends.length > 0) {
        // Create visual bar chart
        const recentDays = trend.dailyTrends.slice(-10);
        const maxCost = Math.max(...recentDays.map((d: any) => Math.max(d.currentMonth || 0, d.previousMonth || 0)));

        // Chart header
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text('Day', 30, y);
        doc.text('Current', 60, y);
        doc.text('Previous', 95, y);
        doc.text('Visual', 130, y);
        y += 5;

        recentDays.forEach((day: any) => {
          const currentCost = day.currentMonth || 0;
          const previousCost = day.previousMonth || 0;
          const changePct = day.changePercent || 0;

          // Day
          doc.setTextColor(60);
          doc.text(day.date, 30, y);

          // Current cost
          doc.setTextColor(changePct > 0 ? 220 : 16, changePct > 0 ? 38 : 185, changePct > 0 ? 38 : 129);
          doc.text(`$${currentCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 60, y);

          // Previous cost
          doc.setTextColor(100);
          doc.text(`$${previousCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 95, y);

          // Visual bar
          const barWidth = maxCost > 0 ? (currentCost / maxCost) * 40 : 0;
          const barColor: [number, number, number] = changePct > 20 ? [239, 68, 68] :
                                                     changePct > 0 ? [234, 179, 8] :
                                                     [16, 185, 129];
          doc.setFillColor(barColor[0], barColor[1], barColor[2]);
          doc.rect(130, y - 3, barWidth, 4, 'F');

          // Change indicator
          const changeSymbol = changePct > 0 ? '+' : '';
          doc.setTextColor(barColor[0], barColor[1], barColor[2]);
          doc.text(`${changeSymbol}${changePct.toFixed(0)}%`, 175, y);

          y += 6;
          if (y > 270) { doc.addPage(); y = 20; }
        });
        y += 8;
      }
    });
  }

  // Cost Anomalies Section
  if (reportData?.costAnomalies && reportData.costAnomalies.length > 0) {
    if (y > 220) { doc.addPage(); y = 20; }

    doc.setFillColor(254, 252, 232);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'F');
    doc.setDrawColor(234, 179, 8);
    doc.setLineWidth(0.5);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'S');

    doc.setFontSize(14);
    doc.setTextColor(180, 83, 9);
    doc.text('⚠ Cost Anomalies Detected', 20, y);
    y += 15;

    doc.setFontSize(9);
    reportData.costAnomalies.slice(0, 6).forEach((anomaly: any) => {
      const severityColor = anomaly.severity === 'critical' ? [220, 38, 38] :
                           anomaly.severity === 'high' ? [249, 115, 22] :
                           anomaly.severity === 'medium' ? [234, 179, 8] :
                           [100, 116, 139];

      doc.setFillColor(severityColor[0], severityColor[1], severityColor[2]);
      doc.circle(22, y - 2, 2, 'F');

      doc.setTextColor(60);
      doc.text(`${anomaly.resourceGroup}`, 28, y);
      doc.text(`${anomaly.severity.toUpperCase()}`, pageWidth - 80, y);

      const deviationText = `${anomaly.deviationPercent >= 0 ? '+' : ''}${anomaly.deviationPercent.toFixed(0)}%`;
      doc.setTextColor(severityColor[0], severityColor[1], severityColor[2]);
      doc.text(deviationText, pageWidth - 35, y, { align: 'right' });
      y += 7;

      doc.setTextColor(100);
      doc.setFontSize(8);
      doc.text(`  Expected: $${anomaly.expectedCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}, Actual: $${anomaly.actualCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 28, y);
      y += 6;
      if (y > 270) { doc.addPage(); y = 20; }
    });
    y += 8;
  }

  // Resource Type Breakdown with Pie Chart Style
  if (reportData?.resourceTypeBreakdown && reportData.resourceTypeBreakdown.length > 0) {
    if (y > 200) { doc.addPage(); y = 20; }

    doc.setFillColor(240, 253, 244);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'F');
    doc.setDrawColor(16, 185, 129);
    doc.setLineWidth(0.5);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'S');

    doc.setFontSize(14);
    doc.setTextColor(16, 185, 129);
    doc.text('Resource Type Cost Breakdown', 20, y);
    y += 12;

    const topTypes = reportData.resourceTypeBreakdown.slice(0, 6);
    const maxTypeCost = Math.max(...topTypes.map((t: any) => t.currentMonthCost || 0));

    topTypes.forEach((type: any, idx: number) => {
      const typeColors: [number, number, number][] = [
        [16, 185, 129], [59, 130, 246], [139, 92, 246], [249, 115, 22], [236, 72, 153], [14, 165, 233]
      ];
      const color = typeColors[idx % typeColors.length];

      // Resource type icon/box
      doc.setFillColor(color[0], color[1], color[2]);
      doc.roundedRect(20, y - 4, 8, 8, 2, 2, 'F');

      // Resource type name
      doc.setFontSize(9);
      doc.setTextColor(60);
      doc.text(type.resourceType, 32, y);

      // Cost bar
      const barWidth = maxTypeCost > 0 ? (type.currentMonthCost / maxTypeCost) * 60 : 0;
      doc.setFillColor(230, 230, 230);
      doc.rect(100, y - 3, 60, 5, 'F');
      doc.setFillColor(color[0], color[1], color[2]);
      doc.rect(100, y - 3, barWidth, 5, 'F');

      // Cost value
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`$${type.currentMonthCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 165, y);
      doc.text(`${type.percentageOfTotal.toFixed(1)}%`, pageWidth - 35, y, { align: 'right' });

      y += 10;
      if (y > 270) { doc.addPage(); y = 20; }
    });
    y += 8;
  }

  // Subscription Comparison
  if (reportData?.subscriptionComparisons && reportData.subscriptionComparisons.length > 1) {
    if (y > 200) { doc.addPage(); y = 20; }

    doc.setFillColor(238, 242, 255);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'F');
    doc.setDrawColor(99, 102, 241);
    doc.setLineWidth(0.5);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'S');

    doc.setFontSize(14);
    doc.setTextColor(79, 70, 229);
    doc.text('Subscription Comparison', 20, y);
    y += 12;

    const maxSubCost = Math.max(...reportData.subscriptionComparisons.map((s: any) => s.currentMonthCost || 0));

    reportData.subscriptionComparisons.forEach((sub: any) => {
      // Rank badge
      const rankColors: [number, number, number][] = [
        [234, 179, 8], [192, 192, 192], [205, 127, 50], [100, 116, 139]
      ];
      const rankColor = rankColors[Math.min(sub.rank - 1, 3)];
      doc.setFillColor(rankColor[0], rankColor[1], rankColor[2]);
      doc.circle(26, y - 2, 4, 'F');
      doc.setFontSize(7);
      doc.setTextColor(255, 255, 255);
      doc.text(`${sub.rank}`, 26, y, { align: 'center' });

      // Subscription name
      doc.setFontSize(9);
      doc.setTextColor(60);
      doc.text(sub.subscriptionName.substring(0, 20), 35, y);

      // Cost bar
      const barWidth = maxSubCost > 0 ? (sub.currentMonthCost / maxSubCost) * 70 : 0;
      const changeColor = sub.costChange > 0 ? [220, 38, 38] : sub.costChange < 0 ? [16, 185, 129] : [100, 116, 139];
      doc.setFillColor(230, 230, 230);
      doc.rect(100, y - 3, 70, 5, 'F');
      doc.setFillColor(changeColor[0], changeColor[1], changeColor[2]);
      doc.rect(100, y - 3, barWidth, 5, 'F');

      // Cost and change
      doc.setFontSize(8);
      doc.setTextColor(60);
      doc.text(`$${sub.currentMonthCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 175, y);
      const changeText = `${sub.costChangePercent >= 0 ? '+' : ''}${sub.costChangePercent.toFixed(1)}%`;
      doc.setTextColor(changeColor[0], changeColor[1], changeColor[2]);
      doc.text(changeText, pageWidth - 35, y, { align: 'right' });

      y += 10;
      if (y > 270) { doc.addPage(); y = 20; }
    });
    y += 8;
  }

  // Optimization opportunities
  if (optimizationOpportunities.length > 0) {
    if (y > 220) { doc.addPage(); y = 20; }

    doc.setFillColor(254, 242, 242);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'F');
    doc.setDrawColor(239, 68, 68);
    doc.setLineWidth(0.5);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'S');

    doc.setFontSize(14);
    doc.setTextColor(239, 68, 68);
    doc.text('Optimization Opportunities', 20, y);
    y += 15;

    doc.setFontSize(9);
    doc.setTextColor(60);
    optimizationOpportunities.slice(0, 8).forEach((o: { resource: { name: string }; reason: string; potentialSavings: number }) => {
      doc.setTextColor(220, 38, 38);
      doc.text('•', 25, y);
      doc.setTextColor(60);
      doc.text(`${o.resource.name}`, 32, y);
      y += 5;
      doc.text(`  ${o.reason}`, 32, y);
      doc.setTextColor(220, 38, 38);
      doc.text(`Save $${o.potentialSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo`, pageWidth - 35, y, { align: 'right' });
      y += 8;
      if (y > 270) { doc.addPage(); y = 20; }
    });
    y += 5;
  }

  // Historical Trends Section (7d, 30d, 90d views)
  if (reportData?.historicalTrends && reportData.historicalTrends.length > 0) {
    if (y > 200) { doc.addPage(); y = 20; }

    doc.setFillColor(245, 243, 255);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'F');
    doc.setDrawColor(139, 92, 246);
    doc.setLineWidth(0.5);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'S');

    doc.setFontSize(14);
    doc.setTextColor(124, 58, 237);
    doc.text('Historical Cost Trends', 20, y);
    y += 12;

    // Summary table for each period
    doc.setFontSize(9);
    doc.setTextColor(60);
    doc.text('Period', 25, y);
    doc.text('Total Cost', 70, y);
    doc.text('Avg/Day', 115, y);
    doc.text('Growth', 160, y);
    y += 8;

    reportData.historicalTrends.forEach((trend: any) => {
      const periodLabel = trend.period === '7d' ? 'Last 7 Days' :
                         trend.period === '30d' ? 'Last 30 Days' :
                         trend.period === '90d' ? 'Last 90 Days' : trend.period;

      const growthColor = trend.growthRate > 10 ? [239, 68, 68] :
                         trend.growthRate < -5 ? [16, 185, 129] :
                         [100, 116, 139];

      doc.setTextColor(60);
      doc.text(periodLabel, 25, y);
      doc.text(`$${trend.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 70, y);
      doc.text(`$${trend.averageDailyCost.toFixed(2)}`, 115, y);

      const growthText = `${trend.growthRate >= 0 ? '+' : ''}${trend.growthRate.toFixed(1)}%`;
      doc.setTextColor(growthColor[0], growthColor[1], growthColor[2]);
      doc.text(growthText, 160, y);

      // Draw mini sparkline if daily data available
      if (trend.dailyData && trend.dailyData.length > 0) {
        const sparklineData = trend.dailyData.slice(-7);
        const maxVal = Math.max(...sparklineData.map((d: any) => d.cost || 0));
        const barWidth = 3;
        const startX = 195;

        sparklineData.forEach((day: any, idx: number) => {
          const barHeight = maxVal > 0 ? (day.cost / maxVal) * 8 : 0;
          const color: [number, number, number] = trend.growthRate > 10 ? [239, 68, 68] :
                                                   trend.growthRate < 0 ? [16, 185, 129] :
                                                   [139, 92, 246];
          doc.setFillColor(color[0], color[1], color[2]);
          doc.rect(startX + idx * (barWidth + 1), y - barHeight, barWidth, barHeight, 'F');
        });
      }

      y += 10;
      if (y > 270) { doc.addPage(); y = 20; }
    });
    y += 8;
  }

  // Cost Forecast Section
  if (reportData?.forecast) {
    if (y > 220) { doc.addPage(); y = 20; }

    doc.setFillColor(240, 249, 255);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'F');
    doc.setDrawColor(14, 165, 233);
    doc.setLineWidth(0.5);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'S');

    doc.setFontSize(14);
    doc.setTextColor(2, 132, 199);
    doc.text('Cost Forecast', 20, y);
    y += 12;

    const forecast = reportData.forecast;

    // Forecast cards
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(20, y - 4, 55, 25, 3, 3, 'F');
    doc.roundedRect(82, y - 4, 55, 25, 3, 3, 'F');
    doc.roundedRect(144, y - 4, 55, 25, 3, 3, 'F');

    // Current Month Projected
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text('Current Month', 25, y + 4);
    doc.setFontSize(11);
    doc.setTextColor(30);
    doc.text(`$${forecast.currentMonthProjected.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 25, y + 14);

    // Next Month
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text('Next Month', 87, y + 4);
    doc.setFontSize(11);
    doc.setTextColor(30);
    doc.text(`$${forecast.nextMonthForecast.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 87, y + 14);

    // 3 Months
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text('3 Months', 149, y + 4);
    doc.setFontSize(11);
    doc.setTextColor(30);
    doc.text(`$${forecast.threeMonthForecast.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 149, y + 14);

    y += 30;

    // Trend indicator
    const trendEmoji = forecast.trendDirection === 'increasing' ? '📈' :
                      forecast.trendDirection === 'decreasing' ? '📉' : '➡️';
    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.text(`${trendEmoji} Trend: ${forecast.trendDirection.charAt(0).toUpperCase() + forecast.trendDirection.slice(1)}`, 25, y);

    // Confidence interval
    doc.text(`Confidence: $${forecast.confidenceInterval.lower.toLocaleString(undefined, { maximumFractionDigits: 0 })} - $${forecast.confidenceInterval.upper.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 100, y);
    y += 12;

    // Visual forecast chart
    doc.setFillColor(230, 230, 230);
    doc.rect(25, y, pageWidth - 50, 8, 'F');

    const maxForecast = Math.max(forecast.currentMonthProjected, forecast.nextMonthForecast, forecast.threeMonthForecast);
    const currentWidth = maxForecast > 0 ? (forecast.currentMonthProjected / maxForecast) * (pageWidth - 50) : 0;
    const nextWidth = maxForecast > 0 ? (forecast.nextMonthForecast / maxForecast) * (pageWidth - 50) : 0;
    const threeWidth = maxForecast > 0 ? (forecast.threeMonthForecast / maxForecast) * (pageWidth - 50) : 0;

    doc.setFillColor(14, 165, 233);
    doc.rect(25, y, currentWidth, 8, 'F');
    doc.setFillColor(59, 130, 246);
    doc.rect(25, y, nextWidth * 0.7, 8, 'F');
    doc.setFillColor(99, 102, 241);
    doc.rect(25, y, threeWidth * 0.4, 8, 'F');

    y += 15;
  }

  // Resource Efficiency Section
  if (reportData?.resourceEfficiency && reportData.resourceEfficiency.length > 0) {
    if (y > 220) { doc.addPage(); y = 20; }

    doc.setFillColor(240, 253, 244);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'F');
    doc.setDrawColor(16, 185, 129);
    doc.setLineWidth(0.5);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'S');

    doc.setFontSize(14);
    doc.setTextColor(16, 185, 129);
    doc.text('Resource Efficiency Scores', 20, y);
    y += 12;

    // Top inefficient resource groups
    const topEfficiency = reportData.resourceEfficiency
      .filter((e: any) => e.overallScore < 80)
      .slice(0, 5);

    topEfficiency.forEach((rg: any) => {
      if (y > 270) { doc.addPage(); y = 20; }

      // Score badge
      const scoreColor = rg.overallScore >= 80 ? [16, 185, 129] :
                          rg.overallScore >= 60 ? [234, 179, 8] :
                          [239, 68, 68];
      doc.setFillColor(scoreColor[0], scoreColor[1], scoreColor[2]);
      doc.roundedRect(20, y - 5, 15, 10, 2, 2, 'F');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text(`${rg.overallScore}`, 27, y, { align: 'center' });

      // Resource group name
      doc.setFontSize(9);
      doc.setTextColor(60);
      doc.text(rg.resourceGroup.substring(0, 30), 40, y);

      // Score bars
      doc.setFillColor(230, 230, 230);
      doc.rect(100, y - 3, 40, 5, 'F');
      doc.rect(145, y - 3, 40, 5, 'F');

      const utilColor: [number, number, number] = rg.utilizationScore >= 60 ? [16, 185, 129] : [239, 68, 68];
      doc.setFillColor(utilColor[0], utilColor[1], utilColor[2]);
      doc.rect(100, y - 3, (rg.utilizationScore / 100) * 40, 5, 'F');

      const costEffColor: [number, number, number] = rg.costEfficiency >= 60 ? [16, 185, 129] : [239, 68, 68];
      doc.setFillColor(costEffColor[0], costEffColor[1], costEffColor[2]);
      doc.rect(145, y - 3, (rg.costEfficiency / 100) * 40, 5, 'F');

      // Labels
      doc.setFontSize(7);
      doc.setTextColor(100);
      doc.text('Util', 100, y + 5);
      doc.text('Cost', 145, y + 5);

      y += 12;
    });
    y += 8;
  }

  // Cost Savings Recommendations Section
  if (reportData?.savingsRecommendations && reportData.savingsRecommendations.length > 0) {
    if (y > 200) { doc.addPage(); y = 20; }

    doc.setFillColor(236, 252, 240);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'F');
    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(0.5);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'S');

    doc.setFontSize(14);
    doc.setTextColor(22, 163, 74);
    doc.text('Cost Savings Recommendations', 20, y);
    y += 12;

    reportData.savingsRecommendations.slice(0, 5).forEach((rec: any) => {
      if (y > 260) { doc.addPage(); y = 20; }

      // ROI badge
      const roiColor: [number, number, number] = (rec.roi ?? 0) >= 5 ? [34, 197, 94] :
                                                  (rec.roi ?? 0) >= 2 ? [234, 179, 8] :
                                                  [239, 68, 68];
      doc.setFillColor(roiColor[0], roiColor[1], roiColor[2]);
      doc.roundedRect(20, y - 4, 12, 12, 2, 2, 'F');
      doc.setFontSize(7);
      doc.setTextColor(255, 255, 255);
      doc.text(`${(rec.roi ?? 0).toFixed(1)}x`, 26, y + 3, { align: 'center' });

      // Recommendation title
      doc.setFontSize(10);
      doc.setTextColor(30);
      doc.text(rec.recommendation.substring(0, 40), 36, y + 2);

      // Resource group
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`in ${rec.resourceGroup.substring(0, 25)}`, 36, y + 8);

      // Savings amount
      doc.setFontSize(10);
      doc.setTextColor(16, 185, 129);
      doc.text(`Save $${rec.projectedSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo`, pageWidth - 40, y + 2, { align: 'right' });

      // Difficulty and Impact badges
      const diffColor: [number, number, number] = rec.difficulty === 'easy' ? [34, 197, 94] :
                                                 rec.difficulty === 'medium' ? [234, 179, 8] :
                                                 [239, 68, 68];
      doc.setFillColor(diffColor[0], diffColor[1], diffColor[2]);
      doc.roundedRect(36, y + 12, 25, 6, 1, 1, 'F');
      doc.setFontSize(6);
      doc.setTextColor(255, 255, 255);
      doc.text(rec.difficulty.toUpperCase(), 48, y + 16, { align: 'center' });

      const impactColor: [number, number, number] = rec.impact === 'high' ? [34, 197, 94] :
                                                   rec.impact === 'medium' ? [234, 179, 8] :
                                                   [239, 68, 68];
      doc.setFillColor(impactColor[0], impactColor[1], impactColor[2]);
      doc.roundedRect(64, y + 12, 25, 6, 1, 1, 'F');
      doc.text(rec.impact.toUpperCase(), 76, y + 16, { align: 'center' });

      // Action steps
      doc.setFontSize(7);
      doc.setTextColor(120);
      doc.text('Steps: ' + rec.actionSteps.slice(0, 2).join('; '), 92, y + 16);

      y += 25;
    });
    y += 8;
  }

  // Monthly Heatmap Section
  if (reportData?.monthlyHeatmaps && reportData.monthlyHeatmaps.length > 0) {
    if (y > 200) { doc.addPage(); y = 20; }

    doc.setFillColor(254, 242, 254);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'F');
    doc.setDrawColor(168, 85, 247);
    doc.setLineWidth(0.5);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'S');

    doc.setFontSize(14);
    doc.setTextColor(147, 51, 234);
    doc.text('Cost Heatmap - Daily Patterns', 20, y);
    y += 12;

    const heatmap = reportData.monthlyHeatmaps[0];

    // Legend
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text('Low', 25, y);
    doc.setFillColor(219, 234, 254);
    doc.rect(40, y - 4, 15, 6, 'F');
    doc.setFillColor(134, 239, 172);
    doc.rect(57, y - 4, 15, 6, 'F');
    doc.setFillColor(253, 224, 71);
    doc.rect(74, y - 4, 15, 6, 'F');
    doc.setFillColor(252, 165, 165);
    doc.rect(91, y - 4, 15, 6, 'F');
    doc.text('High', 108, y);
    y += 10;

    // Draw heatmap cells (simplified - show first 7 resource groups)
    const topGroups = [...new Set(heatmap.cells.map((c: any) => c.resourceGroup))].slice(0, 7);
    const cellSize = 8;

    (topGroups as string[]).forEach((group: string) => {
      if (y > 270) { doc.addPage(); y = 20; }

      // Group label
      doc.setFontSize(7);
      doc.setTextColor(60);
      doc.text(group.substring(0, 15), 20, y + 4);

      // Day cells (show days 1-15)
      for (let day = 1; day <= 15; day++) {
        const cell = heatmap.cells.find((c: any) => c.resourceGroup === group && c.day === day);
        const colorHex = cell?.color || '#f3f4f6';

        // Convert hex to RGB (simplified)
        const r = parseInt(colorHex.slice(1, 3), 16) || 243;
        const g = parseInt(colorHex.slice(3, 5), 16) || 244;
        const b = parseInt(colorHex.slice(5, 7), 16) || 246;

        doc.setFillColor(r, g, b);
        doc.rect(50 + (day - 1) * (cellSize + 1), y - 2, cellSize, cellSize, 'F');
      }

      y += 11;
    });

    // Day numbers
    doc.setFontSize(6);
    doc.setTextColor(100);
    for (let day = 1; day <= 15; day++) {
      doc.text(`${day}`, 52 + (day - 1) * (cellSize + 1), y - 2);
    }
    y += 8;
  }

  // Detailed Changes Section
  if (reportData?.detailedChanges && reportData.detailedChanges.length > 0) {
    if (y > 200) { doc.addPage(); y = 20; }

    doc.setFillColor(254, 250, 240);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'F');
    doc.setDrawColor(245, 158, 11);
    doc.setLineWidth(0.5);
    doc.rect(15, y - 6, pageWidth - 30, 8, 'S');

    doc.setFontSize(14);
    doc.setTextColor(217, 119, 6);
    doc.text('Detailed Change Tracking', 20, y);
    y += 12;

    reportData.detailedChanges.slice(0, 6).forEach((change: any) => {
      if (y > 260) { doc.addPage(); y = 20; }

      // Change type indicator
      const changeIcon = change.changeType === 'created' ? '+' :
                         change.changeType === 'deleted' ? '-' : '⟳';
      const iconColor: [number, number, number] = change.changeType === 'created' ? [34, 197, 94] :
                                                   change.changeType === 'deleted' ? [239, 68, 68] :
                                                   [234, 179, 8];
      doc.setFillColor(iconColor[0], iconColor[1], iconColor[2]);
      doc.circle(24, y - 2, 4, 'F');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text(changeIcon, 24, y, { align: 'center' });

      // Resource info
      doc.setFontSize(9);
      doc.setTextColor(60);
      doc.text(change.resourceName.substring(0, 30), 32, y);

      // Cost impact
      const impactColor: [number, number, number] = change.costImpact > 0 ? [220, 38, 38] : [16, 185, 129];
      const impactSymbol = change.costImpact > 0 ? '+' : '';
      doc.setTextColor(impactColor[0], impactColor[1], impactColor[2]);
      doc.text(`${impactSymbol}$${change.costImpact.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, pageWidth - 35, y, { align: 'right' });
      y += 8;

      // Diff indicators
      if (change.diffIndicators && change.diffIndicators.length > 0) {
        doc.setFontSize(7);
        doc.setTextColor(100);
        change.diffIndicators.slice(0, 2).forEach((diff: any, idx: number) => {
          doc.text(`${diff.visualIcon} ${diff.field}: ${diff.oldValue} → ${diff.newValue}`, 32, y + (idx * 5));
        });
        y += 12;
      }

      // Change reason
      doc.setFontSize(7);
      doc.setTextColor(120);
      doc.text(`Reason: ${change.changeReason}`, 32, y);
      y += 10;
    });
    y += 5;
  }

  // Budget status
  if (budgetLimit > 0) {
    if (y > 250) { doc.addPage(); y = 20; }

    doc.setFontSize(14);
    doc.setTextColor(30);
    doc.text('Budget Status', 20, y);
    y += 10;

    const budgetPct = filteredTotalCost > 0 ? (filteredTotalCost / budgetLimit) * 100 : 0;
    const budgetColor: [number, number, number] = budgetPct > 100 ? [239, 68, 68] : budgetPct > 80 ? [234, 179, 8] : [16, 185, 129];

    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.text(`Budget Limit: $${budgetLimit.toLocaleString()}`, 25, y); y += 6;
    doc.text(`Current Spend: ${budgetPct.toFixed(1)}%`, 25, y); y += 8;

    // Budget bar
    doc.setFillColor(230, 230, 230);
    doc.rect(25, y, pageWidth - 50, 10, 'F');
    const filledWidth = Math.min((budgetPct / 100) * (pageWidth - 50), pageWidth - 50);
    doc.setFillColor(budgetColor[0], budgetColor[1], budgetColor[2]);
    doc.rect(25, y, filledWidth, 10, 'F');
    y += 15;
  }

  // Footer
  doc.setFillColor(16, 185, 129);
  doc.rect(0, 290, pageWidth, 15, 'F');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('CloudViz - Azure FinOps Dashboard', pageWidth / 2, 298, { align: 'center' });

  doc.save(`cloudviz-enhanced-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}
