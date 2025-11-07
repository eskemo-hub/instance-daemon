#!/usr/bin/env node

/**
 * Rebuild backends.json from existing HAProxy configuration
 * This is useful when backends.json is missing or corrupted
 * Run: node scripts/rebuild-backends-from-haproxy.js
 */

const fs = require('fs');
const path = require('path');

const HAPROXY_CONFIG = '/opt/n8n-daemon/haproxy/haproxy.cfg';
const BACKENDS_FILE = '/opt/n8n-daemon/haproxy/backends.json';

function rebuildBackends() {
  if (!fs.existsSync(HAPROXY_CONFIG)) {
    console.error(`❌ HAProxy config not found at ${HAPROXY_CONFIG}`);
    process.exit(1);
  }

  console.log(`Reading HAProxy config from ${HAPROXY_CONFIG}...`);
  const configContent = fs.readFileSync(HAPROXY_CONFIG, 'utf-8');

  const backends = {};

  // Extract PostgreSQL backends
  const postgresBackendRegex = /backend postgres_([^\s]+)\s+mode tcp\s+option tcp-check\s+server ([^\s]+) 127.0.0.1:(\d+) check/g;
  const postgresUseBackendRegex = /use_backend postgres_([^\s]+) if \{ req\.ssl_sni -i ([^\s]+) \}/g;

  // Map backend names to domains
  const backendToDomain = {};
  let match;
  while ((match = postgresUseBackendRegex.exec(configContent)) !== null) {
    const backendName = match[1];
    const domain = match[2];
    backendToDomain[backendName] = domain;
  }

  // Extract backend server definitions
  while ((match = postgresBackendRegex.exec(configContent)) !== null) {
    const backendName = match[1];
    const instanceName = match[2];
    const port = parseInt(match[3], 10);

    const domain = backendToDomain[backendName] || null;

    if (instanceName && port) {
      backends[instanceName] = {
        instanceName: instanceName,
        domain: domain || `unknown-${instanceName}`,
        port: port,
        dbType: 'postgres'
      };
      console.log(`Found: ${instanceName} -> ${domain || 'unknown'} : ${port}`);
    }
  }

  // Extract MySQL backends (similar pattern)
  const mysqlBackendRegex = /backend mysql_([^\s]+)\s+mode tcp\s+option tcp-check\s+server ([^\s]+) 127.0.0.1:(\d+) check/g;
  const mysqlUseBackendRegex = /use_backend mysql_([^\s]+) if \{ req\.ssl_sni -i ([^\s]+) \}/g;

  const mysqlBackendToDomain = {};
  while ((match = mysqlUseBackendRegex.exec(configContent)) !== null) {
    const backendName = match[1];
    const domain = match[2];
    mysqlBackendToDomain[backendName] = domain;
  }

  while ((match = mysqlBackendRegex.exec(configContent)) !== null) {
    const backendName = match[1];
    const instanceName = match[2];
    const port = parseInt(match[3], 10);

    const domain = mysqlBackendToDomain[backendName] || null;

    if (instanceName && port) {
      backends[instanceName] = {
        instanceName: instanceName,
        domain: domain || `unknown-${instanceName}`,
        port: port,
        dbType: 'mysql'
      };
      console.log(`Found: ${instanceName} -> ${domain || 'unknown'} : ${port}`);
    }
  }

  if (Object.keys(backends).length === 0) {
    console.log('⚠️  No backends found in HAProxy config');
    process.exit(0);
  }

  // Ensure directory exists
  const dir = path.dirname(BACKENDS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    console.log(`Created directory: ${dir}`);
  }

  // Write backends.json
  fs.writeFileSync(
    BACKENDS_FILE,
    JSON.stringify(backends, null, 2),
    { mode: 0o664 }
  );

  console.log(`\n✅ Rebuilt backends.json with ${Object.keys(backends).length} backend(s)`);
  console.log(`   Saved to: ${BACKENDS_FILE}`);
  console.log('\nBackends:');
  Object.values(backends).forEach(backend => {
    console.log(`  - ${backend.instanceName}: ${backend.domain} -> 127.0.0.1:${backend.port} (${backend.dbType})`);
  });
}

try {
  rebuildBackends();
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}

