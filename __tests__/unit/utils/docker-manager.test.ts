import { dockerManager } from '../../../src/utils/docker-manager';
import Docker from 'dockerode';

describe('DockerManager', () => {
  it('should get Docker instance', () => {
    const docker = dockerManager.getDocker();
    expect(docker).toBeInstanceOf(Docker);
  });

  it('should reuse the same Docker instance', () => {
    const docker1 = dockerManager.getDocker();
    const docker2 = dockerManager.getDocker();
    expect(docker1).toBe(docker2);
  });

  it('should test connection', async () => {
    // This will fail if Docker is not available, but should not throw
    const result = await dockerManager.testConnection();
    expect(typeof result).toBe('boolean');
  });
});

