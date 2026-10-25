#!/usr/bin/env bun
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createRemoteApp } from './app';
import { remoteConfig } from './config';

// Separate process with the same SQLite volume. Never checks out or executes customer code.
const options={...remoteConfig(process.env),repositoryWorker:true};
await mkdir(dirname(options.databasePath),{recursive:true,mode:0o700});
const {repositories,auth}=createRemoteApp(options);
const keepAlive=setInterval(()=>{},60_000);
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;repositories.close();clearInterval(keepAlive);const deadline=setTimeout(()=>process.exit(1),25_000);void repositories.drained().then(()=>{clearTimeout(deadline);auth.close();process.exit(0);});};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
console.log('Joinlet repository worker started.');
