import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false
  },
  test: {
    // Only this checkout's tests: agent worktrees under .claude/worktrees/ carry
    // their own tests/ copies that must not run (or double-count) here.
    include: ['tests/**/*.test.ts']
  }
});
