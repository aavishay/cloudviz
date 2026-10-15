// ─── normalizeEnvTag ──────────────────────────────────────────────────────────────

const ENV_TAG_ALIASES: Record<string, string> = {
  prod: 'Production', prd: 'Production', production: 'Production',
  dev: 'Development', develop: 'Development', development: 'Development',
  stg: 'Staging', stage: 'Staging', staging: 'Staging',
  qa: 'Test/QA', test: 'Test/QA', tst: 'Test/QA', uat: 'Test/QA',
};

// normalizeEnvTag maps an Environment tag value onto the buckets the UI filters by
// ("Prod", "prd" and "production" are all Production); other values are title-cased.
export function normalizeEnvTag(value: string): string {
  const v = value.trim();
  if (!v) return 'Untagged';
  return ENV_TAG_ALIASES[v.toLowerCase()] ?? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}
