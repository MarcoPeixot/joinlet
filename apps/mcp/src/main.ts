#!/usr/bin/env bun
import { ADMIN_PLAN, BETA_PLAN, setAccessPlanResolver } from '@strukt/workspace';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { USAGE, dirFromArgv } from './args';
import { createStruktServer } from './server';
import { openMcpWorkspace } from './workspace';

const accessPlan = process.env.JOINLET_LOCAL_ADMIN === '1' ? ADMIN_PLAN : BETA_PLAN;
setAccessPlanResolver(() => accessPlan);
const dir = dirFromArgv(process.argv.slice(2));
if (typeof dir === 'object') {
  console.error(dir.error);
  process.exit(dir.error === USAGE ? 0 : 2);
}
const workspace = await openMcpWorkspace(dir);
if ('error' in workspace) {
  console.error(workspace.error);
  process.exit(1);
}
for (const warning of workspace.warnings) console.error(`aviso: ${warning}`);
await createStruktServer(workspace).connect(new StdioServerTransport());
