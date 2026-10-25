import {expect,it} from 'vitest';
import {createJourney} from './journey';
const connection=(revision='one')=>({analyzedRevision:revision,persistedRevision:'commit-'+revision,phase:'ready',pending:[],proposals:[],pendingWrites:0});
it('migrates only preferences and isolates actual outcomes between workspaces',()=>{
 const memory=new Map([['strukt:checklist',JSON.stringify({hidden:true,collapsed:true,done:{ai:true,publish:true}})]]);
 const storage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v);}};
 const journey=createJourney(storage);journey.open('first');expect(journey.store.getState()).toMatchObject({hidden:true,collapsed:true,done:{}});
 journey.complete('edit');const captured=journey.token();journey.open('second');journey.complete('backup',captured);expect(journey.store.getState().done).toEqual({});journey.open('first');expect(journey.store.getState().done.edit).toBe(true);
});
it('invalidates revision-specific steps and rejects late success callbacks',()=>{
 const journey=createJourney();journey.open('project');journey.connection(connection());const old=journey.token();journey.complete('explore');journey.complete('evidence');journey.confirmReview();journey.saved(true);expect(journey.store.getState().done.save).toBe(true);
 journey.connection(connection('two'));expect(journey.store.getState().done).toEqual({connect:true});journey.complete('evidence',old);expect(journey.store.getState().done.evidence).toBeUndefined();
});
it('requires evidence, exploration, review and completed publication before save',()=>{
 const journey=createJourney();journey.open('project');journey.connection(connection());journey.confirmReview();journey.saved(true);expect(journey.store.getState().done.review).toBeUndefined();
 journey.complete('explore');journey.complete('evidence');journey.connection({...connection(),proposals:[{id:'pending'}]});journey.confirmReview();expect(journey.store.getState().done.review).toBeUndefined();
 journey.connection(connection());journey.confirmReview();journey.saved(false);expect(journey.store.getState().done.save).toBeUndefined();
 journey.connection({...connection(),pendingWrites:1});journey.saved(true);expect(journey.store.getState().done.save).toBeUndefined();
 journey.connection(connection());journey.saved(true);expect(journey.store.getState().done.save).toBe(true);
 journey.connection({...connection(),phase:'disconnected'});expect(journey.store.getState().done.save).toBeUndefined();
});
it('keeps progress in memory when browser storage is unavailable and does not need analytics',()=>{
 const journey=createJourney({getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}});journey.open('first');journey.complete('backup');journey.open('other');journey.open('first');expect(journey.store.getState().done.backup).toBe(true);
});

it('requires a fresh connector confirmation after edits or loss of connectivity',()=>{
 const journey=createJourney();journey.open('project');journey.connection(connection());journey.complete('explore');journey.complete('evidence');journey.confirmReview();journey.saved(true);
 journey.saved(false);journey.saved(true);expect(journey.store.getState().done.save).toBeUndefined();
 journey.connection(connection());journey.saved(true);expect(journey.store.getState().done.save).toBe(true);
 journey.unavailable();journey.saved(true);expect(journey.store.getState().done.save).toBeUndefined();
 const old=journey.token();journey.open('other');journey.unavailable(old);expect(journey.store.getState().connection).toBeNull();
});
