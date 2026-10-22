import {lazy,Suspense} from 'react';
import {analyticsEnabled} from './client';
const View=lazy(()=>import('./ConsentView').then(module=>({default:module.AnalyticsConsent})));
/** Optional UI and its styles are downloaded only on configured installations. */
export function AnalyticsConsent(){return analyticsEnabled()?<Suspense fallback={null}><View/></Suspense>:null;}
