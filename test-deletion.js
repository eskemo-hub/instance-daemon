#!/usr/bin/env node

/**
 * Test script to verify container deletion and folder cleanup
 * This script tests both Docker volume and bind mount cleanup scenarios
 */

const { DockerService } = require('./dist/services/docker.service');
const fs = require('fs');
const path = require('path');

async function testDeletion() {
  const dockerService = new DockerService();
  
  console.log('🧪 Testing container deletion and folder cleanup...\n');

  // Test 1: Docker Volume cleanup
  console.log('📦 Test 1: Docker Volume Cleanup');
  try {
    const volumeConfig = {
      name: 'test-volume-container',
      port: 8001,
      volumeName: 'test-n8n-volume',
      image: 'n8nio/n8n:latest'
    };

    console.log('  ✅ Creating container with Docker volume...');
    const volumeContainer = await dockerService.createN8nContainer(volumeConfig);
    console.log(`  ✅ Container created: ${volumeContainer.containerId}`);

    console.log('  🗑️  Removing container and volume...');
    await dockerService.removeContainer(volumeContainer.containerId, true);
    console.log('  ✅ Container and volume removed successfully\n');

  } catch (error) {
    console.error('  ❌ Volume test failed:', error.message);
  }

  // Test 2: Bind Mount cleanup
  console.log('📁 Test 2: Bind Mount Cleanup');
  try {
    const testDir = path.join(__dirname, 'test-bind-mount');
    
    const bindConfig = {
      name: 'test-bind-container',
      port: 8002,
      volumeName: 'test-bind-volume', // Still required but won't be used
      hostPath: testDir,
      image: 'n8nio/n8n:latest'
    };

    console.log('  ✅ Creating container with bind mount...');
    const bindContainer = await dockerService.createN8nContainer(bindConfig);
    console.log(`  ✅ Container created: ${bindContainer.containerId}`);
    
    // Verify directory was created
    if (fs.existsSync(testDir)) {
      console.log(`  ✅ Bind mount directory created: ${testDir}`);
    } else {
      console.log(`  ⚠️  Bind mount directory not found: ${testDir}`);
    }

    console.log('  🗑️  Removing container and bind mount...');
    await dockerService.removeContainer(bindContainer.containerId, true);
    
    // Verify directory was removed
    if (!fs.existsSync(testDir)) {
      console.log('  ✅ Bind mount directory removed successfully');
    } else {
      console.log('  ❌ Bind mount directory still exists!');
    }

  } catch (error) {
    console.error('  ❌ Bind mount test failed:', error.message);
  }

  console.log('\n🎉 Deletion tests completed!');
}

// Run the test
testDeletion().catch(console.error);