import type { Database } from 'bun:sqlite';

/** Startup only: WAL upgrades can return BUSY without invoking SQLite's busy handler. */
export function configureRuntimeDatabase(db: Database): void {
  db.exec('PRAGMA busy_timeout=5000');
  const deadline=Date.now()+5000;
  const signal=new Int32Array(new SharedArrayBuffer(4));
  for(;;){
    try { db.exec('PRAGMA journal_mode=WAL'); return; }
    catch(error){
      if((error as {code?:string}).code!=='SQLITE_BUSY'||Date.now()>=deadline)throw error;
      Atomics.wait(signal,0,0,Math.min(25,deadline-Date.now()));
    }
  }
}
