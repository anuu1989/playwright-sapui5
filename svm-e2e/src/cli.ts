import { BdClient } from './bd-client';
import { loadSettings, requireEnv, storePath } from './config';
import { notifyFinished, summarize } from './notify';
import { cleanup, startRun, tick, type Deps } from './orchestrator';
import { ApiScanUploader } from './scan-uploader';
import { RunStore } from './store';

function deps(): Deps {
  const cfg = loadSettings();
  const bd = new BdClient(cfg.blackduck.url, requireEnv('BD_API_TOKEN'));
  return {
    bd,
    uploader: new ApiScanUploader(
      bd,
      cfg.blackduck.sbom_upload_path,
      cfg.blackduck.sbom_content_type,
    ),
    store: new RunStore(storePath()),
    cfg,
  };
}

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'start':
      await startRun(deps());
      break;
    case 'tick':
      await tick(deps());
      break;
    case 'cleanup': {
      const r = await cleanup(deps());
      console.log(JSON.stringify(r));
      if (r.stuck.length) process.exitCode = 1;
      break;
    }
    case 'notify':
      await notifyFinished(new RunStore(storePath()));
      break;
    case 'status':
      for (const run of new RunStore(storePath()).all())
        console.log(`${summarize(run)} | next ${run.nextCheckAt}`);
      break;
    default:
      console.error('usage: cli.ts start | tick | notify | cleanup | status');
      process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
