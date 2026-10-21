#!/usr/bin/env node
import {main} from '../lib/cli.mjs';
try{await main(process.argv.slice(2));}catch(e){console.error(JSON.stringify({error:e.message}));process.exitCode=1;}
