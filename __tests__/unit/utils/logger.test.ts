import logger from '../../../src/utils/logger';

describe('Logger', () => {
  it('should create a logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('should log at different levels', () => {
    // These should not throw
    expect(() => logger.debug('Debug message')).not.toThrow();
    expect(() => logger.info('Info message')).not.toThrow();
    expect(() => logger.warn('Warning message')).not.toThrow();
    expect(() => logger.error('Error message')).not.toThrow();
  });

  it('should log with structured data', () => {
    expect(() => {
      logger.info({ userId: '123', action: 'test' }, 'Test action');
    }).not.toThrow();
  });
});

