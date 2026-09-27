import * as migration_20260927_154152_init from './20260927_154152_init';

export const migrations = [
  {
    up: migration_20260927_154152_init.up,
    down: migration_20260927_154152_init.down,
    name: '20260927_154152_init'
  },
];
