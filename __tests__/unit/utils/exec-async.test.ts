import { execCommand, execCommandStdout, spawnCommand } from '../../../src/utils/exec-async';

describe('exec-async', () => {
  describe('execCommand', () => {
    it('should execute a simple command', async () => {
      const result = await execCommand('echo "test"');
      expect(result.stdout.trim()).toBe('test');
      expect(result.stderr).toBe('');
    });

    it('should handle command errors', async () => {
      await expect(execCommand('false')).rejects.toThrow();
    });

    it('should respect timeout', async () => {
      // This should timeout quickly
      await expect(
        execCommand('sleep 10', { timeout: 100 })
      ).rejects.toThrow();
    }, 5000);
  });

  describe('execCommandStdout', () => {
    it('should return stdout as string', async () => {
      const result = await execCommandStdout('echo "hello world"');
      expect(result).toBe('hello world');
    });
  });

  describe('spawnCommand', () => {
    it('should spawn a command', async () => {
      await expect(spawnCommand('echo', ['test'])).resolves.not.toThrow();
    });

    it('should handle spawn errors', async () => {
      await expect(spawnCommand('nonexistent-command-xyz123')).rejects.toThrow();
    });
  });
});

