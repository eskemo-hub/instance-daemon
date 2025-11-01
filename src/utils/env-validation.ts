/**
 * Environment Variable Validation for Daemon
 * 
 * Validates required environment variables on daemon startup
 * to prevent runtime errors due to missing configuration.
 */

interface EnvValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validates that all required environment variables are present
 * @returns Validation result with any errors found
 */
export function validateEnvironment(): EnvValidationResult {
  const errors: string[] = [];

  // Required environment variables
  const requiredVars = [
    'API_KEY',
  ];

  // Check each required variable
  for (const varName of requiredVars) {
    const value = process.env[varName];
    
    if (!value || value.trim() === '') {
      errors.push(`Missing required environment variable: ${varName}`);
    } else if (value.includes('your-') || value.includes('generate-with')) {
      errors.push(`Environment variable ${varName} has not been configured (still contains placeholder value)`);
    }
  }

  // Validate API_KEY length (should be at least 32 characters for security)
  const apiKey = process.env.API_KEY;
  if (apiKey && apiKey.length < 32) {
    errors.push('API_KEY should be at least 32 characters long for security');
  }

  // Validate NODE_ENV
  const validNodeEnvs = ['development', 'production', 'test'];
  if (process.env.NODE_ENV && !validNodeEnvs.includes(process.env.NODE_ENV)) {
    errors.push(`NODE_ENV must be one of: ${validNodeEnvs.join(', ')}`);
  }

  // Validate PORT
  const port = process.env.PORT;
  if (port) {
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      errors.push('PORT must be a valid port number between 1 and 65535');
    }
  }

  // Validate SSL configuration (if provided, both cert and key must be present)
  const sslCert = process.env.SSL_CERT_PATH;
  const sslKey = process.env.SSL_KEY_PATH;
  if ((sslCert && !sslKey) || (!sslCert && sslKey)) {
    errors.push('Both SSL_CERT_PATH and SSL_KEY_PATH must be provided if using SSL');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates environment and throws an error if validation fails
 * Use this at application startup to fail fast if configuration is invalid
 */
export function validateEnvironmentOrThrow(): void {
  const result = validateEnvironment();
  
  if (!result.isValid) {
    const errorMessage = [
      '❌ Environment validation failed:',
      '',
      ...result.errors.map(err => `  • ${err}`),
      '',
      '💡 Please check your .env file and ensure all required variables are set.',
      '   See .env.example for reference.',
    ].join('\n');
    
    throw new Error(errorMessage);
  }
}

/**
 * Logs environment validation results
 * Use this for non-critical validation or to show warnings
 */
export function logEnvironmentValidation(): void {
  const result = validateEnvironment();
  
  if (result.isValid) {
    console.log('✅ Environment validation passed');
  } else {
    console.error('❌ Environment validation failed:');
    result.errors.forEach(err => console.error(`  • ${err}`));
    console.error('\n💡 Please check your .env file and ensure all required variables are set.');
    console.error('   See .env.example for reference.\n');
  }
}
