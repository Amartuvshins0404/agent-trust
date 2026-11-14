#!/usr/bin/env node
process.exitCode = require("../lib/setup.cjs").main(process.argv.slice(2));
