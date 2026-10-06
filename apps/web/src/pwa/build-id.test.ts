import { describe, expect, it } from 'vitest';
import { buildIdOf } from './build-id';

describe('which build is running', () => {
  it('is the hash in the name of the entry file', () => {
    expect(buildIdOf(['https://x.dev/assets/index-FlVn6Y_s.js'])).toBe('FlVn6Y_s');
    expect(buildIdOf(['/assets/index-a-b_9.js?v=1'])).toBe('a-b_9');
  });

  it('skips other scripts to find it', () => {
    expect(
      buildIdOf([
        '',
        'https://x.dev/assets/insights-page-BYN7Yi6K.js',
        '/assets/index-BMaNYn9J.js',
      ]),
    ).toBe('BMaNYn9J');
  });

  it('is "dev" when there is no built entry file (the dev server, a test)', () => {
    expect(buildIdOf([])).toBe('dev');
    expect(buildIdOf(['/src/main.tsx', '/@vite/client'])).toBe('dev');
    expect(buildIdOf(['/assets/index-ABC.css'])).toBe('dev');
  });
});
