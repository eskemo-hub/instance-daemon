#!/usr/bin/env node
/**
 * Environment Validation CLI Script for Daemon
 * 
 * Run this script to validate your daemon environment configuration.
 * Usage: npm run validate-env
 */

const dotenv = require('dotenv');
const { validateEnvironment, logEnvironmentValidation } = require('./env-validation');

// Load environment variables
dotenv.config();

console.log('🔍 Validating daemon environment configuration...\n');

logEnvironmentValidation();

const result = validateEnvironment();

if (!result.isValid) {
  process.exit(1);
}

console.log('\n✨ Daemon environment is properly configured and ready to use!\n');
process.exit(0);
