#!/usr/bin/env bun
import { config } from 'dotenv';
import { runCli } from './cli.js';

// Load environment variables
config({ quiet: true });

const [subcommand, ...rest] = process.argv.slice(2);

if (subcommand === 'watch') {
  // Autonomous compliance monitoring (daemon). No interactive REPL.
  const { runWatchCommand } = await import('./watch/cli.js');
  await runWatchCommand(rest);
} else {
  await runCli();
}
