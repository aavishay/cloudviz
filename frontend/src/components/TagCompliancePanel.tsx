import { useState } from 'react';
import './TagCompliancePanel.css';

interface TagComplianceData {
  generatedAt: string;
  totalResources: number;
  requiredTags: string[];
  overallCompliance: number;
  compliantResources: number;
  tagBreakdown: Array<{
    tagName: string;
    compliantCount: number;
    nonCompliantCount: number;
    complianceRate: number;
    percentageOfTotal: number;
  }>;
  nonCompliantResources: Array<{
    id: string;
    name: string;
    type: string;
    resourceGroup: string;
    subscriptionId: string;
    missingTags: string[];
    presentTags: Record<string, string>;
    cost: number;
  }>;
  complianceByRG: Array<{
    resourceGroup: string;
    totalResources: number;
    compliantCount: number;
    complianceRate: number;
  }>;
  complianceByType: Array<{
    resourceType: string;
    totalResources: number;
    compliantCount: number;
    complianceRate: number;
  }>;
}

interface TagCompliancePanelProps {
  data: TagComplianceData | null;
  onViewNonCompliant: () => void;
}

const getComplianceColor = (rate: number): string => {
  if (rate >= 80) return '#00f5d4'; // Cyan
  if (rate >= 50) return '#f72585'; // Magenta
  return '#ff2e63'; // Red
};

const getComplianceGlow = (rate: number): string => {
  if (rate >= 80) return '0 0 20px rgba(0, 245, 212, 0.5)';
  if (rate >= 50) return '0 0 20px rgba(247, 37, 133, 0.5)';
  return '0 0 20px rgba(255, 46, 99, 0.5)';
};

export function TagCompliancePanel({ data, onViewNonCompliant }: TagCompliancePanelProps) {
  const [selectedView, setSelectedView] = useState<'overview' | 'byRG' | 'byType'>('overview');
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);
  const [isVisible] = useState(true);

  if (!data) {
    return (
      <div className="tcp-loading">
        <div className="tcp-loading-grid" />
        <span className="tcp-loading-text">INITIALIZING SCAN...</span>
      </div>
    );
  }

  const complianceColor = getComplianceColor(data.overallCompliance);
  const complianceGlow = getComplianceGlow(data.overallCompliance);

  return (
    <div className={`tcp-panel ${isVisible ? 'tcp-visible' : ''}`}>
      {/* Background Effects */}
      <div className="tcp-bg-grid" />
      <div className="tcp-bg-noise" />
      <div className="tcp-scanline" />

      {/* Header */}
      <div className="tcp-header tcp-animate-in">
        <div className="tcp-header-left">
          <div className="tcp-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              <path d="M12 7l-4 4" />
            </svg>
          </div>
          <div className="tcp-title-group">
            <h2 className="tcp-title">TAG COMPLIANCE</h2>
            <span className="tcp-subtitle">
              {data.totalResources.toLocaleString()} RESOURCES · {data.requiredTags.join(' · ')}
            </span>
          </div>
        </div>
        <div className="tcp-compliance-score">
          <span
            className="tcp-score-value tcp-animate-scale"
            style={{ color: complianceColor, textShadow: complianceGlow }}
          >
            {data.overallCompliance.toFixed(1)}%
          </span>
          <span className="tcp-score-label">COMPLIANT</span>
        </div>
      </div>

      {/* Main Progress Bar */}
      <div className="tcp-main-progress tcp-animate-in tcp-delay-1">
        <div className="tcp-progress-track">
          <div
            className="tcp-progress-fill"
            style={{
              width: `${data.overallCompliance}%`,
              background: `linear-gradient(90deg, ${complianceColor} 0%, ${complianceColor}dd 100%)`,
              boxShadow: complianceGlow
            }}
          />
        </div>
        <div className="tcp-progress-markers">
          {[0, 25, 50, 75, 100].map((marker) => (
            <div
              key={marker}
              className="tcp-marker"
              style={{ left: `${marker}%` }}
            >
              <div className="tcp-marker-line" />
              <span className="tcp-marker-label">{marker}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="tcp-stats-grid tcp-animate-in tcp-delay-2">
        <div className="tcp-stat-card tcp-stat-success">
          <div className="tcp-stat-glow" />
          <span className="tcp-stat-value" style={{ color: '#00f5d4' }}>
            {data.compliantResources.toLocaleString()}
          </span>
          <span className="tcp-stat-label">COMPLIANT</span>
        </div>

        <div
          className="tcp-stat-card tcp-stat-danger"
          onClick={onViewNonCompliant}
        >
          <div className="tcp-stat-glow" />
          <span className="tcp-stat-value" style={{ color: '#ff2e63' }}>
            {data.nonCompliantResources.length.toLocaleString()}
          </span>
          <span className="tcp-stat-label">NON-COMPLIANT</span>
          <div className="tcp-click-hint">CLICK TO VIEW</div>
        </div>
      </div>

      {/* Tag Breakdown */}
      <div className="tcp-tag-breakdown tcp-animate-in tcp-delay-3">
        <h3 className="tcp-section-title">// TAG ANALYSIS</h3>
        <div className="tcp-tags-list">
          {data.tagBreakdown.map((tag, index) => {
            const tagColor = getComplianceColor(tag.complianceRate);
            return (
              <div
                key={tag.tagName}
                className="tcp-tag-item"
                style={{ animationDelay: `${0.4 + index * 0.1}s` }}
                onMouseEnter={() => setHoveredTag(tag.tagName)}
                onMouseLeave={() => setHoveredTag(null)}
              >
                <div className="tcp-tag-header">
                  <span className="tcp-tag-name">{tag.tagName}</span>
                  <span
                    className="tcp-tag-rate"
                    style={{ color: tagColor }}
                  >
                    {tag.complianceRate.toFixed(1)}%
                  </span>
                </div>
                <div className="tcp-tag-bar-container">
                  <div
                    className="tcp-tag-bar"
                    style={{
                      width: `${tag.complianceRate}%`,
                      background: `linear-gradient(90deg, ${tagColor} 0%, ${tagColor}aa 100%)`,
                      boxShadow: hoveredTag === tag.tagName ? `0 0 15px ${tagColor}66` : 'none'
                    }}
                  />
                </div>
                <div className="tcp-tag-stats">
                  <span>{tag.compliantCount.toLocaleString()} OK</span>
                  <span>{tag.nonCompliantCount.toLocaleString()} MISSING</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* View Toggle */}
      <div className="tcp-view-toggle tcp-animate-in tcp-delay-4">
        {(['overview', 'byRG', 'byType'] as const).map((view) => (
          <button
            key={view}
            className={`tcp-toggle-btn ${selectedView === view ? 'active' : ''}`}
            onClick={() => setSelectedView(view)}
          >
            {view === 'overview' ? 'OVERVIEW' : view === 'byRG' ? 'BY RESOURCE GROUP' : 'BY TYPE'}
          </button>
        ))}
      </div>

      {/* Content Area */}
      {selectedView === 'byRG' && (
        <div className="tcp-detail-list tcp-animate-in">
          <h3 className="tcp-section-title">// RESOURCE GROUP COMPLIANCE</h3>
          {data.complianceByRG.slice(0, 5).map((rg, index) => {
            const rgColor = getComplianceColor(rg.complianceRate);
            return (
              <div
                key={rg.resourceGroup}
                className="tcp-detail-item"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className="tcp-detail-info">
                  <span className="tcp-detail-name">{rg.resourceGroup}</span>
                  <span className="tcp-detail-count">{rg.totalResources} resources</span>
                </div>
                <div className="tcp-detail-bar-wrap">
                  <div
                    className="tcp-detail-bar"
                    style={{ width: `${rg.complianceRate}%`, background: rgColor }}
                  />
                </div>
                <span className="tcp-detail-rate" style={{ color: rgColor }}>
                  {rg.complianceRate.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      )}

      {selectedView === 'byType' && (
        <div className="tcp-detail-list tcp-animate-in">
          <h3 className="tcp-section-title">// RESOURCE TYPE COMPLIANCE</h3>
          {data.complianceByType.slice(0, 5).map((type, index) => {
            const typeColor = getComplianceColor(type.complianceRate);
            const typeName = type.resourceType.split('/').pop() || type.resourceType;
            return (
              <div
                key={type.resourceType}
                className="tcp-detail-item"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className="tcp-detail-info">
                  <span className="tcp-detail-name">{typeName}</span>
                  <span className="tcp-detail-count">{type.totalResources} resources</span>
                </div>
                <div className="tcp-detail-bar-wrap">
                  <div
                    className="tcp-detail-bar"
                    style={{ width: `${type.complianceRate}%`, background: typeColor }}
                  />
                </div>
                <span className="tcp-detail-rate" style={{ color: typeColor }}>
                  {type.complianceRate.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="tcp-footer tcp-animate-in tcp-delay-5">
        <span className="tcp-timestamp">
          LAST SCAN: {new Date(data.generatedAt).toLocaleString()}
        </span>
        <div className="tcp-status-indicators">
          <span className="tcp-status">
            <span className="tcp-status-dot" style={{ background: '#00f5d4' }} />
            LIVE
          </span>
        </div>
      </div>
    </div>
  );
}
