#!/usr/bin/env bun

import { Command } from 'commander';
import { loadConfig } from './config';
import { D1Client } from './db';
import { R2Uploader } from './uploader';
import { Scanner } from './scanner';
import { TMDBClient } from './tmdb';

const program = new Command();

program
  .name('cf-video')
  .description('CLI tool for managing CF-Video media library')
  .version('0.1.0');

program
  .command('scan:movies <directory>')
  .description('Scan a directory for movie files and upload to R2')
  .action(async (directory: string) => {
    const config = loadConfig();
    const db = new D1Client(config);
    const uploader = new R2Uploader(config);
    const tmdb = new TMDBClient(config);
    const scanner = new Scanner(uploader, db, tmdb);

    console.log(`Scanning movies: ${directory}\n`);
    const result = await scanner.scanMoviesDirectory(directory);

    console.log('\n--- Scan Complete ---');
    console.log(`  Total files:  ${result.total}`);
    console.log(`  Uploaded:     ${result.uploaded}`);
    console.log(`  Skipped:      ${result.skipped}`);
    console.log(`  Errors:       ${result.errors}`);
  });

program
  .command('scan:tv <directory>')
  .description('Scan a directory for TV show files and upload to R2')
  .action(async (directory: string) => {
    const config = loadConfig();
    const db = new D1Client(config);
    const uploader = new R2Uploader(config);
    const tmdb = new TMDBClient(config);
    const scanner = new Scanner(uploader, db, tmdb);

    console.log(`Scanning TV shows: ${directory}\n`);
    const result = await scanner.scanTVDirectory(directory);

    console.log('\n--- Scan Complete ---');
    console.log(`  Total files:  ${result.total}`);
    console.log(`  Uploaded:     ${result.uploaded}`);
    console.log(`  Skipped:      ${result.skipped}`);
    console.log(`  Errors:       ${result.errors}`);
  });

program
  .command('scan:all <directory>')
  .description('Scan a directory for both movies and TV shows')
  .action(async (directory: string) => {
    const config = loadConfig();
    const db = new D1Client(config);
    const uploader = new R2Uploader(config);
    const tmdb = new TMDBClient(config);
    const scanner = new Scanner(uploader, db, tmdb);

    // First scan for movies (flat files)
    console.log('Scanning for movies...\n');
    const movieResult = await scanner.scanMoviesDirectory(directory);

    // Then scan for TV shows (directory structure)
    console.log('\n\nScanning for TV shows...\n');
    const tvResult = await scanner.scanTVDirectory(directory);

    console.log('\n\n=== Scan Complete ===');
    console.log('Movies:');
    console.log(`  Total: ${movieResult.total}`);
    console.log(`  Uploaded: ${movieResult.uploaded}`);
    console.log(`  Skipped: ${movieResult.skipped}`);
    console.log(`  Errors: ${movieResult.errors}`);
    console.log('TV Shows:');
    console.log(`  Total: ${tvResult.total}`);
    console.log(`  Uploaded: ${tvResult.uploaded}`);
    console.log(`  Skipped: ${tvResult.skipped}`);
    console.log(`  Errors: ${tvResult.errors}`);
  });

program
  .command('stats')
  .description('Show library statistics')
  .action(async () => {
    const config = loadConfig();
    const db = new D1Client(config);

    const stats = await db.getStats();
    console.log('Library Statistics:');
    console.log(`  Movies:    ${stats.movies}`);
    console.log(`  TV Shows:  ${stats.tvShows}`);
    console.log(`  Seasons:   ${stats.seasons}`);
    console.log(`  Episodes:  ${stats.episodes}`);
    console.log(`  Users:     ${stats.users}`);
  });

program
  .command('user:create')
  .description('Create a new user')
  .requiredOption('--username <username>', 'Username')
  .requiredOption('--password <password>', 'Password')
  .option('--admin', 'Make user an admin', false)
  .action(async (opts: { username: string; password: string; admin: boolean }) => {
    const config = loadConfig();
    const db = new D1Client(config);

    const id = crypto.randomUUID();
    await db.createUser(id, opts.username, opts.password, opts.admin);
    console.log(`User created: ${opts.username} (id: ${id}, admin: ${opts.admin})`);
  });

program
  .command('user:list')
  .description('List all users')
  .action(async () => {
    const config = loadConfig();
    const db = new D1Client(config);

    const users = await db.getUsers();
    console.log('Users:');
    users.forEach(u => {
      console.log(`  ${u.username} (${u.id})${u.is_admin ? ' [admin]' : ''}`);
    });
  });

program
  .command('nuke')
  .description('Delete ALL metadata from D1 (DANGER)')
  .option('--confirm', 'Required to proceed')
  .action(async (opts: { confirm?: boolean }) => {
    if (!opts.confirm) {
      console.error('This will DELETE ALL DATA from D1. Pass --confirm to proceed.');
      process.exit(1);
    }

    const config = loadConfig();
    const db = new D1Client(config);

    console.log('Deleting all data from D1...');
    await db.nukeAll();
    console.log('Done. All D1 tables have been cleared.');
  });

program.parse();