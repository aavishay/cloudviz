import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

// ─── Portal ───────────────────────────────────────────────────────────────────

interface PortalProps {
  children: ReactNode;
}

export function Portal({ children }: PortalProps) {
  return createPortal(children, document.body);
}

// ─── StatusDot ────────────────────────────────────────────────────────────────

interface StatusDotProps {
  status: string;
}

export function StatusDot({ status }: StatusDotProps) {
  const colors: Record<string, string> = {
    Succeeded: 'var(--accent)',
    Running: 'var(--blue)',
    Failed: 'var(--danger)',
    Stopped: 'var(--text-2)',
    Deallocated: 'var(--text-3)',
    Updating: 'var(--blue)',
  };
  const color = colors[status] || 'var(--text-3)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 500 }}>{status}</span>
    </span>
  );
}

// ─── EmptyState ─────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
}

export function EmptyState({ icon, message }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon && <div style={{ marginBottom: 8, opacity: 0.4 }}>{icon}</div>}
      <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.02 }}>{message}</span>
    </div>
  );
}

// ─── ChevronIcon ────────────────────────────────────────────────────────────────

interface ChevronIconProps {
  open: boolean;
}

export function ChevronIcon({ open }: ChevronIconProps) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.2s ease',
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ─── Resource Type Names ──────────────────────────────────────────────────────

export const RESOURCE_TYPE_NAMES: Record<string, string> = {
  'microsoft.compute/virtualmachines': 'Virtual Machine',
  'microsoft.network/networkinterfaces': 'Network Interface',
  'microsoft.network/publicipaddresses': 'Public IP',
  'microsoft.network/virtualnetworks': 'Virtual Network',
  'microsoft.network/networksecuritygroups': 'Security Group',
  'microsoft.storage/storageaccounts': 'Storage Account',
  'microsoft.compute/disks': 'Managed Disk',
  'microsoft.operationalinsights/workspaces': 'Log Analytics',
  'microsoft.insights/components': 'App Insights',
  'microsoft.web/sites': 'App Service',
  'microsoft.sql/servers/databases': 'SQL Database',
  'microsoft.containerservice/managedclusters': 'AKS Cluster',
  'microsoft.web/serverfarms': 'App Service Plan',
  'microsoft.containerregistry/registries': 'Container Registry',
  'microsoft.keyvault/vaults': 'Key Vault',
  'microsoft.network/loadbalancers': 'Load Balancer',
  'microsoft.network/applicationgateways': 'App Gateway',
  'microsoft.network/azurefirewalls': 'Azure Firewall',
  'microsoft.network/bastionhosts': 'Bastion Host',
  'microsoft.network/routetables': 'Route Table',
  'microsoft.network/privatednszones': 'Private DNS Zone',
  'microsoft.network/privateendpoints': 'Private Endpoint',
  'microsoft.dbforredis/redis': 'Redis Cache',
  'microsoft.search/searchservices': 'Search Service',
  'microsoft.automation/automationaccounts': 'Automation Account',
  'microsoft.network/dnszones': 'DNS Zone',
  'microsoft.network/networkwatchers': 'Network Watcher',
  'microsoft.compute/availabilitysets': 'Availability Set',
  'microsoft.compute/snapshots': 'Snapshot',
  'microsoft.eventhub/namespaces': 'Event Hub',
  'microsoft.servicebus/namespaces': 'Service Bus',
  'microsoft.network/p2svpngateways': 'P2S VPN Gateway',
  'microsoft.network/privatelinkhubs': 'Private Link Hub',
  'microsoft.insights/queries': 'Query',
  'microsoft.insights/scheduledqueryrules': 'Scheduled Query Rule',
  'microsoft.recoveryservices/vaults': 'Recovery Vault',
  // Short form
  'virtualmachines': 'Virtual Machine',
  'networkinterfaces': 'Network Interface',
  'publicipaddresses': 'Public IP',
  'virtualnetworks': 'Virtual Network',
  'networksecuritygroups': 'Security Group',
  'storageaccounts': 'Storage Account',
  'disks': 'Managed Disk',
  'workspaces': 'Workspace',
  'components': 'App Insights',
  'sites': 'App Service',
  'databases': 'Database',
  'managedclusters': 'AKS Cluster',
  'serverfarms': 'App Service Plan',
  'registries': 'Container Registry',
  'vaults': 'Key Vault',
  'loadbalancers': 'Load Balancer',
  'applicationgateways': 'App Gateway',
  'routetables': 'Route Table',
  'redis': 'Redis Cache',
};

// ─── friendlyType ───────────────────────────────────────────────────────────────

export function friendlyType(type: string): string {
  if (!type) return 'Unknown';
  const low = type.toLowerCase();
  if (RESOURCE_TYPE_NAMES[low]) return RESOURCE_TYPE_NAMES[low];
  const last = type.split('/').pop() || type;
  if (RESOURCE_TYPE_NAMES[last.toLowerCase()]) return RESOURCE_TYPE_NAMES[last.toLowerCase()];
  return last.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').trim()
    .split(' ').filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// ─── inferEnvFromRG ─────────────────────────────────────────────────────────────

export function inferEnvFromRG(rg: string): string {
  if (!rg) return 'Unknown';
  const low = rg.toLowerCase();
  if (low.includes('prod') || low.includes('production')) return 'Production';
  if (low.includes('dev') || low.includes('development')) return 'Development';
  if (low.includes('stag') || low.includes('staging')) return 'Staging';
  if (low.includes('test') || low.includes('qa') || low.includes('uat')) return 'Test/QA';
  if (low.includes('dr') || low.includes('disaster') || low.includes('backup')) return 'DR';
  return 'Unknown';
}

// ─── getTimeAgo ───────────────────────────────────────────────────────────────────

export function getTimeAgo(timestamp: string): string {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}
