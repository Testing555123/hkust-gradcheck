import * as migration_20260927_154152_init from './20260927_154152_init';
import * as migration_20260928_170856_source_chunks from './20260928_170856_source_chunks';

export const migrations = [
  {
    up: migration_20260927_154152_init.up,
    down: migration_20260927_154152_init.down,
    name: '20260927_154152_init',
  },
  {
    up: migration_20260928_170856_source_chunks.up,
    down: migration_20260928_170856_source_chunks.down,
    name: '20260928_170856_source_chunks'
  },
];
