import {normalizeGeometry,geometryAudit} from './geometry.js';
import {interpretPrimitives} from './primitives.js';
import {normalizeSpatialPlan} from './spatialPlan.js';

// Deterministic offline integration path for CI. No network, Studio or screenshot
// is used; placeholders are metadata, and MUST NOT be scored as images.
export function simulateOfflineJob({inventory,details,profile='balanced',maxParts=180}){
  const plan=normalizeSpatialPlan(inventory,null,inventory?.sizeStuds||[10,10,10]);
  const compiled=interpretPrimitives(details,plan,{profile,maxParts});
  const geometry=normalizeGeometry(compiled,plan);
  const audit=geometryAudit(geometry,plan);
  return {
    schemaVersion:2,simulated:true,plan,geometry,geometryAudit:audit,
    placeholders:['front','side','top'].map(view=>({view,simulated:true,imageAvailable:false})),
    warnings:compiled.warnings
  };
}
