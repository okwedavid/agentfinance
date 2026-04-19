#!/usr/bin/env node
/**
 * server.js - Railway deployment entry point for Next.js standalone
 *
 * Next.js standalone output location depends on whether outputFileTracingRoot
 * is set. With a monorepo root tracing, the server ends up nested.
 * This script finds the correct server.js and runs it.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync, spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
process.env.PORT = PORT;

// Candidate paths for the standalone server, in order of preference
const candidates = [
  // When built from frontend/ directory directly (ideal)
  path.join(__dirname, '.next', 'standalone', 'server.js'),
  // When built from monorepo root with outputFileTracingRoot
  path.join(__dirname, '.next', 'standalone', 'agentfinance', 'frontend', 'server.js'),
  // Other common monorepo patterns
  path.join(__dirname, '.next', 'standalone', 'frontend', 'server.js'),
];

let serverPath = null;
for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    serverPath = candidate;
    break;
  }
}

if (!serverPath) {
  console.error('ERROR: Could not find Next.js standalone server.js');
  console.error('Searched paths:');
  candidates.forEach(p => console.error(' -', p));
  
  // Debug: show what's actually in .next/standalone
  const standaloneDir = path.join(__dirname, '.next', 'standalone');
  if (fs.existsSync(standaloneDir)) {
    console.error('\nContents of .next/standalone:');
    const walk = (dir, indent = '') => {
      try {
        fs.readdirSync(dir).forEach(f => {
          const full = path.join(dir, f);
          console.error(indent + f);
          if (fs.statSync(full).isDirectory() && indent.length < 6) {
            walk(full, indent + '  ');
          }
        });
      } catch(e) {}
    };
    walk(standaloneDir);
  } else {
    console.error('.next/standalone directory does not exist!');
  }
  process.exit(1);
}

console.log(`Starting Next.js standalone server from: ${serverPath}`);
console.log(`PORT: ${PORT}`);

// Run the standalone server
require(serverPath);