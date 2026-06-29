#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔧 Starting Vercel build fix...');

// 1. Remove problematic packages before build
console.log('📦 Removing problematic packages...');
try {
  execSync('pnpm remove better-sqlite3 keytar', { stdio: 'inherit' });
} catch (e) {
  console.log('Packages may already be removed, continuing...');
}

// 2. Install with hoisted structure
console.log('📦 Reinstalling with hoisted structure...');
execSync('pnpm install --frozen-lockfile --node-linker=hoisted', { stdio: 'inherit' });

// 3. Build the app
console.log('🏗️ Building Next.js app...');
execSync('pnpm run build', { stdio: 'inherit' });

// 4. Remove all symlinks from standalone directory
console.log('🧹 Removing symlinks from standalone directory...');
const standaloneDir = path.join(process.cwd(), '.next', 'standalone');

function removeSymlinks(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    try {
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        console.log(`  Removing symlink: ${fullPath}`);
        fs.unlinkSync(fullPath);
      } else if (stat.isDirectory()) {
        removeSymlinks(fullPath);
      }
    } catch (err) {
      // Ignore
    }
  }
}

removeSymlinks(standaloneDir);
console.log('✅ Symlink cleanup complete!');

// 5. Create a fake node_modules with required packages
console.log('📦 Creating minimal node_modules for Vercel...');
const nodeModulesDir = path.join(standaloneDir, 'node_modules');
if (fs.existsSync(nodeModulesDir)) {
  // Remove any symlinks in node_modules
  removeSymlinks(nodeModulesDir);
}

console.log('✅ Build fix complete!');
