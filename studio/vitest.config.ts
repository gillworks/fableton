// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // .mjs bin helpers run on the VPS with bare node (no tsx); test them as-is.
    include: ['src/**/*.test.ts', 'bin/**/*.test.mjs'],
  },
});
